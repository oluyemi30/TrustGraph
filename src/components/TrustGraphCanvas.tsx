import React, { useMemo, useRef, useState } from 'react';
import {
  ArrowUpRight,
  Maximize2,
  RefreshCw,
  Search,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import { formatEvidenceLabel } from '../lib/api';
import { ROBINHOOD_TESTNET, getExplorerTxUrl, shortenAddress } from '../lib/robinhoodChain';
import { GraphLink, GraphNode } from '../types';

export type ProvenanceFilter = 'all' | 'onchain_verified' | 'offchain_signed' | 'community_external';

interface TrustGraphCanvasProps {
  nodes: GraphNode[];
  links: GraphLink[];
  loading: boolean;
  error: string | null;
  includeRevoked: boolean;
  onToggleIncludeRevoked: (next: boolean) => void;
  selectedEntityId: string | null;
  onSelectEntity: (entityName: string) => void;
  onOpenEntityProfile: (entityName: string) => void;
  onStartAttestation: (entityName: string) => void;
  onRetry: () => void;
  explorerBaseUrl?: string;
}

interface PositionedNode extends GraphNode {
  px: number;
  py: number;
  isEntity: boolean;
  degree: number;
}

export const TrustGraphCanvas: React.FC<TrustGraphCanvasProps> = ({
  nodes,
  links,
  loading,
  error,
  includeRevoked,
  onToggleIncludeRevoked,
  selectedEntityId,
  onSelectEntity,
  onOpenEntityProfile,
  onStartAttestation,
  onRetry,
  explorerBaseUrl,
}) => {
  const [filter, setFilter] = useState<ProvenanceFilter>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const dragOriginRef = useRef<{ x: number; y: number; panX: number; panY: number } | null>(null);

  const filteredLinks = useMemo(() => {
    return links.filter((link) => {
      if (!includeRevoked && link.revoked) return false;
      if (filter === 'onchain_verified') return link.evidenceCategory === 'onchain_verified';
      if (filter === 'offchain_signed') return link.evidenceCategory === 'offchain_signed';
      if (filter === 'community_external') {
        return (
          link.evidenceCategory === 'offchain_community' ||
          link.evidenceCategory === 'external_intuition' ||
          link.evidenceCategory === 'external_intuition_sample'
        );
      }
      return true;
    });
  }, [links, filter, includeRevoked]);

  const { positionedNodes, positionedMap, visibleLinks } = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();

    const degreeCount = new Map<string, number>();
    filteredLinks.forEach((l) => {
      degreeCount.set(l.source, (degreeCount.get(l.source) || 0) + 1);
      degreeCount.set(l.target, (degreeCount.get(l.target) || 0) + 1);
    });

    // Determine which nodes remain visible under search + provenance filter
    const baseNodes = nodes.filter((n) => {
      const isEntity = n.type !== 'wallet_actor' && !n.id.startsWith('user_') && !n.id.startsWith('wallet_');
      if (filter !== 'all' && (degreeCount.get(n.id) || 0) === 0) {
        return false;
      }
      if (!q) return true;
      const matchesSelf = n.label.toLowerCase().includes(q) || n.id.toLowerCase().includes(q);
      if (matchesSelf) return true;
      // Keep connected neighbors of matching nodes so context is preserved
      return filteredLinks.some((l) => {
        if (l.source === n.id) {
          return l.target.toLowerCase().includes(q);
        }
        if (l.target === n.id) {
          return l.source.toLowerCase().includes(q);
        }
        return false;
      }) && !isEntity;
    });

    const entityNodes = baseNodes.filter(
      (n) => !n.id.startsWith('user_') && !n.id.startsWith('wallet_') && n.type !== 'wallet_actor'
    );
    const actorNodes = baseNodes.filter(
      (n) => n.id.startsWith('user_') || n.id.startsWith('wallet_') || n.type === 'wallet_actor'
    );

    const centerX = 460;
    const centerY = 290;
    const placed: PositionedNode[] = [];
    const map = new Map<string, PositionedNode>();

    // Place primary entity nodes in a clean inner ring (or center if 1)
    const entityCount = entityNodes.length;
    const innerRadius = entityCount <= 1 ? 0 : Math.min(165, Math.max(95, entityCount * 24));

    entityNodes.forEach((ent, idx) => {
      const angle = (2 * Math.PI * idx) / Math.max(1, entityCount) - Math.PI / 2;
      const px = entityCount === 1 ? centerX : centerX + Math.cos(angle) * innerRadius;
      const py = entityCount === 1 ? centerY : centerY + Math.sin(angle) * innerRadius;
      const item: PositionedNode = {
        ...ent,
        px,
        py,
        isEntity: true,
        degree: degreeCount.get(ent.id) || 0,
      };
      placed.push(item);
      map.set(ent.id, item);
    });

    // Place attester / actor nodes on an outer ring anchored near their primary target
    const actorCount = actorNodes.length;
    const outerRadius = Math.max(innerRadius + 105, Math.min(255, 185 + actorCount * 5));

    actorNodes.forEach((actor, idx) => {
      const baseAngle = (2 * Math.PI * idx) / Math.max(1, actorCount) - Math.PI / 3;
      const px = centerX + Math.cos(baseAngle) * outerRadius;
      const py = centerY + Math.sin(baseAngle) * outerRadius;
      const item: PositionedNode = {
        ...actor,
        px,
        py,
        isEntity: false,
        degree: degreeCount.get(actor.id) || 0,
      };
      placed.push(item);
      map.set(actor.id, item);
    });

    const activeLinks = filteredLinks.filter((l) => map.has(l.source) && map.has(l.target));

    return {
      positionedNodes: placed,
      positionedMap: map,
      visibleLinks: activeLinks,
    };
  }, [nodes, filteredLinks, filter, searchQuery]);

  const activeNode = useMemo(() => {
    if (!selectedEntityId) return null;
    return (
      positionedMap.get(selectedEntityId.toLowerCase()) ||
      nodes.find((n) => n.id.toLowerCase() === selectedEntityId.toLowerCase()) ||
      null
    );
  }, [selectedEntityId, positionedMap, nodes]);

  const selectedEntityLinks = useMemo(() => {
    if (!selectedEntityId) return [];
    const targetKey = selectedEntityId.toLowerCase();
    return links
      .filter(
        (l) =>
          (includeRevoked || !l.revoked) &&
          (l.target.toLowerCase() === targetKey || l.source.toLowerCase() === targetKey)
      )
      .slice()
      .reverse();
  }, [links, selectedEntityId, includeRevoked]);

  const handlePointerDown = (e: React.PointerEvent<SVGSVGElement>) => {
    if ((e.target as HTMLElement).closest('[data-node-interactive="true"]')) return;
    setIsDragging(true);
    dragOriginRef.current = {
      x: e.clientX,
      y: e.clientY,
      panX: pan.x,
      panY: pan.y,
    };
  };

  const handlePointerMove = (e: React.PointerEvent<SVGSVGElement>) => {
    if (!isDragging || !dragOriginRef.current) return;
    const dx = e.clientX - dragOriginRef.current.x;
    const dy = e.clientY - dragOriginRef.current.y;
    setPan({
      x: dragOriginRef.current.panX + dx,
      y: dragOriginRef.current.panY + dy,
    });
  };

  const handlePointerUp = () => {
    setIsDragging(false);
    dragOriginRef.current = null;
  };

  const resetViewport = () => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
  };

  const getEdgeStyle = (link: GraphLink) => {
    if (link.revoked) {
      return {
        stroke: '#C93535',
        strokeWidth: 1.4,
        strokeDasharray: '2 4',
        opacity: 0.65,
      };
    }
    if (link.evidenceCategory === 'onchain_verified') {
      return {
        stroke: '#00A804',
        strokeWidth: 2.2,
        strokeDasharray: undefined,
        opacity: 0.92,
      };
    }
    if (link.evidenceCategory === 'offchain_signed') {
      return {
        stroke: '#2B352D',
        strokeWidth: 1.65,
        strokeDasharray: undefined,
        opacity: 0.78,
      };
    }
    return {
      stroke: '#879489',
      strokeWidth: 1.35,
      strokeDasharray: '5 4',
      opacity: 0.7,
    };
  };

  return (
    <div className="bg-white border border-[#DDE5DD] rounded-xl overflow-hidden">
      {/* Toolbar */}
      <div className="p-4 border-b border-[#DDE5DD] flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <div
            role="group"
            aria-label="Filter graph edges by provenance"
            className="inline-flex items-center p-1 bg-[#F0F3F0] rounded-lg"
          >
            {(
              [
                { id: 'all', label: 'All Signals' },
                { id: 'onchain_verified', label: 'Verified On-Chain' },
                { id: 'offchain_signed', label: 'Wallet-Signed' },
                { id: 'community_external', label: 'Community & External' },
              ] as const
            ).map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setFilter(tab.id)}
                className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
                  filter === tab.id
                    ? 'bg-white text-[#111713] shadow-xs'
                    : 'text-[#58635A] hover:text-[#111713]'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          <button
            type="button"
            onClick={() => onToggleIncludeRevoked(!includeRevoked)}
            aria-pressed={includeRevoked}
            className={`px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors whitespace-nowrap shrink-0 ${
              includeRevoked
                ? 'bg-[#FFF5F5] border-[#E8B4B4] text-[#9E2424]'
                : 'bg-white border-[#DDE5DD] text-[#58635A] hover:text-[#111713]'
            }`}
          >
            {includeRevoked ? 'Showing Revoked' : 'Include Revoked'}
          </button>
        </div>

        <div className="flex items-center gap-2">
          <div className="relative flex-1 sm:w-56">
            <Search
              className="w-4 h-4 text-[#58635A] absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none"
              aria-hidden="true"
            />
            <input
              type="search"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Filter nodes..."
              aria-label="Search entities or attesters in graph"
              className="w-full pl-9 pr-3 py-1.5 text-sm bg-[#F7F9F7] border border-[#DDE5DD] rounded-lg text-[#111713] placeholder:text-[#738075] focus:bg-white"
            />
          </div>

          <div className="inline-flex items-center border border-[#DDE5DD] rounded-lg bg-white">
            <button
              type="button"
              onClick={() => setZoom((z) => Math.min(2.2, +(z + 0.2).toFixed(2)))}
              aria-label="Zoom in"
              title="Zoom in"
              className="p-2 text-[#58635A] hover:text-[#111713] transition-colors"
            >
              <ZoomIn className="w-4 h-4" />
            </button>
            <button
              type="button"
              onClick={() => setZoom((z) => Math.max(0.55, +(z - 0.2).toFixed(2)))}
              aria-label="Zoom out"
              title="Zoom out"
              className="p-2 text-[#58635A] hover:text-[#111713] transition-colors border-l border-[#DDE5DD]"
            >
              <ZoomOut className="w-4 h-4" />
            </button>
            <button
              type="button"
              onClick={resetViewport}
              aria-label="Reset graph view"
              title="Reset graph view"
              className="p-2 text-[#58635A] hover:text-[#111713] transition-colors border-l border-[#DDE5DD]"
            >
              <Maximize2 className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>

      {/* Main Split: Canvas + Selected Node Inspector */}
      <div className="grid grid-cols-1 lg:grid-cols-12">
        <div className="lg:col-span-8 relative bg-[#F7F9F7] min-h-[460px] flex flex-col justify-between border-b lg:border-b-0 lg:border-r border-[#DDE5DD]">
          {loading ? (
            <div className="flex-1 flex flex-col items-center justify-center p-10 text-center">
              <RefreshCw className="w-6 h-6 text-[#58635A] animate-spin mb-3" aria-hidden="true" />
              <p className="text-sm font-medium text-[#111713]">Loading TrustGraph topology...</p>
              <p className="text-xs text-[#58635A] mt-1">
                Resolving entities, wallet attesters, and relationship provenance.
              </p>
            </div>
          ) : error ? (
            <div className="flex-1 flex flex-col items-center justify-center p-10 text-center">
              <p className="text-sm font-semibold text-[#C93535]">Unable to load graph data</p>
              <p className="text-xs text-[#58635A] mt-1 max-w-md">{error}</p>
              <button
                type="button"
                onClick={onRetry}
                className="mt-4 px-4 py-2 text-xs font-medium bg-[#111713] text-white rounded-lg hover:bg-[#232D26] transition-colors"
              >
                Retry Graph Load
              </button>
            </div>
          ) : positionedNodes.length === 0 ? (
            <div className="flex-1 flex flex-col items-center justify-center p-10 text-center">
              <p className="text-sm font-semibold text-[#111713]">
                No matching graph relationships found
              </p>
              <p className="text-xs text-[#58635A] mt-1 max-w-md">
                {filter !== 'all' || searchQuery
                  ? 'No attestations match the active provenance filter or search query.'
                  : 'Register an entity or submit the first attestation on Robinhood Chain Testnet to populate the graph.'}
              </p>
              {(filter !== 'all' || searchQuery) && (
                <button
                  type="button"
                  onClick={() => {
                    setFilter('all');
                    setSearchQuery('');
                  }}
                  className="mt-4 px-4 py-2 text-xs font-medium bg-white border border-[#DDE5DD] text-[#111713] rounded-lg hover:bg-[#F0F3F0] transition-colors"
                >
                  Reset Graph Filters
                </button>
              )}
            </div>
          ) : (
            <svg
              viewBox="0 0 920 580"
              role="img"
              aria-label="Interactive TrustGraph network visualization showing entities and attestation provenance"
              onPointerDown={handlePointerDown}
              onPointerMove={handlePointerMove}
              onPointerUp={handlePointerUp}
              onPointerLeave={handlePointerUp}
              className={`w-full h-[460px] select-none ${
                isDragging ? 'cursor-grabbing' : 'cursor-grab'
              }`}
            >
              <defs>
                <marker
                  id="arrow-verified"
                  viewBox="0 0 10 10"
                  refX="22"
                  refY="5"
                  markerWidth="6"
                  markerHeight="6"
                  orient="auto-start-reverse"
                >
                  <path d="M 0 1 L 10 5 L 0 9 z" fill="#00A804" />
                </marker>
                <marker
                  id="arrow-signed"
                  viewBox="0 0 10 10"
                  refX="22"
                  refY="5"
                  markerWidth="5"
                  markerHeight="5"
                  orient="auto-start-reverse"
                >
                  <path d="M 0 1 L 10 5 L 0 9 z" fill="#2B352D" />
                </marker>
                <marker
                  id="arrow-unverified"
                  viewBox="0 0 10 10"
                  refX="22"
                  refY="5"
                  markerWidth="5"
                  markerHeight="5"
                  orient="auto-start-reverse"
                >
                  <path d="M 0 1 L 10 5 L 0 9 z" fill="#879489" />
                </marker>
              </defs>

              <g
                transform={`translate(${pan.x + 460 * (1 - zoom)}, ${
                  pan.y + 290 * (1 - zoom)
                }) scale(${zoom})`}
              >
                {/* Relationship Edges */}
                {visibleLinks.map((link) => {
                  const sourceNode = positionedMap.get(link.source);
                  const targetNode = positionedMap.get(link.target);
                  if (!sourceNode || !targetNode) return null;

                  const edgeStyle = getEdgeStyle(link);
                  const isHighlighted =
                    selectedEntityId &&
                    (link.target.toLowerCase() === selectedEntityId.toLowerCase() ||
                      link.source.toLowerCase() === selectedEntityId.toLowerCase());

                  const markerEnd = link.revoked
                    ? undefined
                    : link.evidenceCategory === 'onchain_verified'
                    ? 'url(#arrow-verified)'
                    : link.evidenceCategory === 'offchain_signed'
                    ? 'url(#arrow-signed)'
                    : 'url(#arrow-unverified)';

                  return (
                    <line
                      key={`edge-${link.id}`}
                      x1={sourceNode.px}
                      y1={sourceNode.py}
                      x2={targetNode.px}
                      y2={targetNode.py}
                      stroke={edgeStyle.stroke}
                      strokeWidth={isHighlighted ? edgeStyle.strokeWidth + 0.8 : edgeStyle.strokeWidth}
                      strokeDasharray={edgeStyle.strokeDasharray}
                      opacity={
                        selectedEntityId
                          ? isHighlighted
                            ? 1
                            : 0.25
                          : edgeStyle.opacity
                      }
                      markerEnd={markerEnd}
                    />
                  );
                })}

                {/* Nodes */}
                {positionedNodes.map((node) => {
                  const isSelected =
                    Boolean(selectedEntityId) &&
                    node.id.toLowerCase() === selectedEntityId?.toLowerCase();
                  const hasVerified = (node.verifiedCount || 0) > 0;
                  const radius = node.isEntity ? 20 : 12;

                  return (
                    <g
                      key={node.id}
                      data-node-interactive="true"
                      transform={`translate(${node.px}, ${node.py})`}
                      onClick={() => {
                        if (node.isEntity) {
                          onSelectEntity(node.id);
                        }
                      }}
                      onKeyDown={(e) => {
                        if ((e.key === 'Enter' || e.key === ' ') && node.isEntity) {
                          e.preventDefault();
                          onSelectEntity(node.id);
                        }
                      }}
                      tabIndex={node.isEntity ? 0 : -1}
                      role={node.isEntity ? 'button' : undefined}
                      aria-label={
                        node.isEntity
                          ? `Select entity ${node.label}, score ${node.score || 0} out of 5`
                          : `Contributor ${node.label}`
                      }
                      className={node.isEntity ? 'cursor-pointer focus:outline-none' : ''}
                    >
                      {isSelected && (
                        <circle
                          r={radius + 6}
                          fill="none"
                          stroke="#CCFF00"
                          strokeWidth="2.5"
                          opacity="0.95"
                        />
                      )}
                      <circle
                        r={radius}
                        fill={
                          node.isEntity
                            ? isSelected
                              ? '#0C100C'
                              : '#FFFFFF'
                            : '#EEF2EC'
                        }
                        stroke={
                          isSelected
                            ? '#0C100C'
                            : hasVerified
                            ? '#166B00'
                            : node.isEntity
                            ? '#2B352D'
                            : '#9AA89B'
                        }
                        strokeWidth={node.isEntity ? (hasVerified || isSelected ? 2.4 : 1.7) : 1.3}
                      />

                      {node.isEntity && (
                        <text
                          textAnchor="middle"
                          dy="0.35em"
                          fill={isSelected ? '#CCFF00' : '#0C100C'}
                          fontSize="10"
                          fontWeight="600"
                          className="font-mono tabular-nums pointer-events-none"
                        >
                          {node.score ? node.score.toFixed(1) : '—'}
                        </text>
                      )}

                      <text
                        textAnchor="middle"
                        y={radius + 14}
                        fill={node.isEntity ? '#0C100C' : '#535E54'}
                        fontSize={node.isEntity ? '11.5' : '10'}
                        fontWeight={node.isEntity ? '600' : '400'}
                        className="pointer-events-none"
                      >
                        {node.label.length > 18 ? `${node.label.slice(0, 16)}…` : node.label}
                      </text>
                    </g>
                  );
                })}
              </g>
            </svg>
          )}

          {/* Legend Footer */}
          <div className="px-4 py-3 bg-white border-t border-[#DCE3DC] flex flex-wrap items-center justify-between gap-3 text-xs text-[#535E54]">
            <div className="flex flex-wrap items-center gap-4">
              <span className="inline-flex items-center gap-2">
                <span className="w-5 h-0.5 bg-[#00A804] inline-block" aria-hidden="true" />
                <span>Verified On-Chain (46630)</span>
              </span>
              <span className="inline-flex items-center gap-2">
                <span className="w-5 h-0.5 bg-[#2B352D] inline-block" aria-hidden="true" />
                <span>Wallet-Signed</span>
              </span>
              <span className="inline-flex items-center gap-2">
                <span
                  className="w-5 border-t-2 border-dashed border-[#879489] inline-block"
                  aria-hidden="true"
                />
                <span>Community / External</span>
              </span>
              {includeRevoked && (
                <span className="inline-flex items-center gap-2">
                  <span
                    className="w-5 border-t-2 border-dotted border-[#C93535] inline-block"
                    aria-hidden="true"
                  />
                  <span>Revoked</span>
                </span>
              )}
            </div>
            <span className="tabular-nums">
              {positionedNodes.length} nodes · {visibleLinks.length} edges
            </span>
          </div>
        </div>

        {/* Right Column: Selected Node Relationship Provenance Inspector */}
        <div className="lg:col-span-4 p-5 flex flex-col justify-between bg-white">
          {activeNode ? (
            <div>
              <div className="pb-4 border-b border-[#DCE3DC]">
                <div className="text-xs text-[#535E54] flex items-center gap-1.5">
                  <span className="capitalize">{activeNode.type}</span>
                  <span aria-hidden="true">·</span>
                  <span>
                    {activeNode.originSource === 'intuition'
                      ? 'Intuition (Base)'
                      : activeNode.originSource === 'robinhood_chain'
                      ? 'Robinhood Chain'
                      : 'TrustGraph'}
                  </span>
                </div>
                <h3 className="text-lg font-semibold text-[#0C100C] mt-1">{activeNode.label}</h3>

                <div className="mt-3 grid grid-cols-2 gap-3 text-xs">
                  <div>
                    <div className="text-[#535E54]">Weighted Signal</div>
                    <div className="text-base font-semibold text-[#0C100C] font-mono tabular-nums mt-0.5">
                      {activeNode.score ? `${activeNode.score.toFixed(2)} / 5.00` : 'No active score'}
                    </div>
                  </div>
                  <div>
                    <div className="text-[#535E54]">On-Chain Verified</div>
                    <div className="text-base font-semibold text-[#166B00] font-mono tabular-nums mt-0.5">
                      {activeNode.verifiedCount || 0} record
                      {(activeNode.verifiedCount || 0) === 1 ? '' : 's'}
                    </div>
                  </div>
                </div>

                <div className="mt-4 flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => onOpenEntityProfile(activeNode.id)}
                    className="flex-1 px-3 py-2 text-xs font-medium bg-[#0C100C] text-white rounded-lg hover:bg-[#1A221B] transition-colors whitespace-nowrap cursor-pointer"
                  >
                    Inspect Full Profile
                  </button>
                  <button
                    type="button"
                    onClick={() => onStartAttestation(activeNode.label)}
                    className="px-3 py-2 text-xs font-semibold bg-[#CCFF00] text-[#0C100C] rounded-lg hover:bg-[#B8E600] transition-colors whitespace-nowrap cursor-pointer"
                  >
                    Attest
                  </button>
                </div>
              </div>

              <div className="pt-4">
                <div className="flex items-center justify-between text-xs text-[#58635A] mb-3">
                  <span className="font-medium text-[#111713]">Relationship Provenance</span>
                  <span className="tabular-nums">{selectedEntityLinks.length} records</span>
                </div>

                {selectedEntityLinks.length === 0 ? (
                  <p className="text-xs text-[#58635A] py-4">
                    No incoming attestations recorded for this entity yet. Visual presence alone does
                    not imply on-chain verification.
                  </p>
                ) : (
                  <ul className="divide-y divide-[#DDE5DD] max-h-[270px] overflow-y-auto pr-1">
                    {selectedEntityLinks.slice(0, 10).map((rel) => (
                      <li key={rel.id} className="py-2.5 text-xs">
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-medium text-[#111713] font-mono truncate">
                            {rel.attesterAddress
                              ? shortenAddress(rel.attesterAddress)
                              : `@${rel.fromUser}`}
                          </span>
                          <span className="font-mono font-semibold tabular-nums text-[#111713] shrink-0">
                            {rel.score}/5
                          </span>
                        </div>
                        <div className="text-[11px] text-[#58635A] mt-0.5 flex flex-wrap items-center gap-1.5">
                          <span
                            className={
                              rel.revoked
                                ? 'text-[#C93535] font-medium'
                                : rel.evidenceCategory === 'onchain_verified'
                                ? 'text-[#007A03] font-medium'
                                : ''
                            }
                          >
                            {rel.revoked ? 'Revoked' : formatEvidenceLabel(rel.evidenceCategory)}
                          </span>
                          {rel.verifiedOnChain && rel.txHash && (
                            <>
                              <span aria-hidden="true">·</span>
                              <a
                                href={getExplorerTxUrl(
                                  rel.txHash,
                                  explorerBaseUrl || ROBINHOOD_TESTNET.blockExplorerUrls[0]
                                )}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="inline-flex items-center gap-0.5 text-[#111713] underline hover:text-[#007A03]"
                              >
                                Explorer
                                <ArrowUpRight className="w-3 h-3" aria-hidden="true" />
                              </a>
                            </>
                          )}
                        </div>
                        {rel.comment && (
                          <p className="text-[#58635A] mt-1 line-clamp-2">{rel.comment}</p>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          ) : (
            <div className="my-auto py-8 text-center">
              <p className="text-sm font-medium text-[#111713]">Select an entity node</p>
              <p className="text-xs text-[#58635A] mt-1">
                Click any circular entity node in the graph to inspect its incoming attestations,
                cryptographic verification status, and Explorer receipts.
              </p>
            </div>
          )}

          <p className="text-[11px] text-[#58635A] pt-4 border-t border-[#DDE5DD] mt-4">
            Visual edges reflect recorded claims separated by provenance. Only solid green edges
            correspond to verified <code className="font-mono">TrustGraphRegistry</code> events on
            Robinhood Chain Testnet (46630).
          </p>
        </div>
      </div>
    </div>
  );
};
