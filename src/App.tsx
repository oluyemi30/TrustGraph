import React, { useState, useEffect, useRef } from 'react';
import { 
  Bot, 
  Award, 
  Radio, 
  Network, 
  Database, 
  ShieldCheck, 
  HelpCircle, 
  Send, 
  PlusCircle, 
  Search, 
  Sparkles, 
  AlertTriangle, 
  ArrowRight, 
  User, 
  Terminal, 
  RefreshCw, 
  Layers, 
  CheckCircle2, 
  Layers3,
  BadgeAlert,
  Sliders,
  ChevronRight,
  GitFork
} from 'lucide-react';

interface Atom {
  id: number;
  name: string;
  displayName: string;
  type: 'user' | 'project' | 'wallet';
  created_at: string;
  description: string;
  creator: string;
  average?: number;
  simpleAverage?: number;
  count?: number;
}

interface Attestation {
  id: number;
  from_user: string;
  to_entity: string;
  trust_score: number;
  comment: string;
  timestamp: string;
}

interface GraphNode {
  id: string;
  label: string;
  type: string;
  score?: number;
  x?: number;
  y?: number;
}

interface GraphLink {
  source: string;
  target: string;
  score: number;
  comment: string;
  timestamp: string;
}

interface GlobalStats {
  totalAtoms: number;
  totalAttestations: number;
  totalUsers: number;
  averageConsensusScore: number;
}

interface AIConsensus {
  entityName: string;
  summary: string;
  riskSignals: string[];
  confidenceLevel: 'Low' | 'Medium' | 'High';
  trustScore: number;
  totalClaims: number;
}

interface GraphIntelligenceNode {
  id: string;
  name: string;
  type: string;
  strength: number;
}

interface IndirectPath {
  path: string[];
  score: number;
  influence: number;
}

interface GraphIntelligence {
  entityName: string;
  weightedScore: number;
  riskScore: number;
  riskFactors: string[];
  confidenceScore: number;
  confidenceLevel: 'Low' | 'Medium' | 'High';
  topInfluencingNodes: GraphIntelligenceNode[];
  indirectPaths: IndirectPath[];
}

interface ChatMessage {
  sender: 'user' | 'bot';
  text: string;
  timestamp: string;
}

function parsePathNodeToId(name: string, nodes: GraphNode[]): string {
  const lowercase = name.toLowerCase();
  if (nodes.some(n => n.id === lowercase)) {
    return lowercase;
  }
  const userId = `user_${lowercase}`;
  if (nodes.some(n => n.id === userId)) {
    return userId;
  }
  return lowercase;
}

export default function App() {
  // Navigation
  const [activeTab, setActiveTab] = useState<'graph' | 'ledger' | 'simulator'>('graph');

  // Core Ledgers State
  const [atoms, setAtoms] = useState<Atom[]>([]);
  const [attestations, setAttestations] = useState<Attestation[]>([]);
  const [stats, setStats] = useState<GlobalStats>({
    totalAtoms: 0,
    totalAttestations: 0,
    totalUsers: 0,
    averageConsensusScore: 0
  });

  // Graph Data
  const [graphNodes, setGraphNodes] = useState<GraphNode[]>([]);
  const [graphLinks, setGraphLinks] = useState<GraphLink[]>([]);
  const [hoveredNode, setHoveredNode] = useState<string | null>(null);

  // Search & Filter
  const [searchQuery, setSearchQuery] = useState('');
  const [filterType, setFilterType] = useState<string>('all');

  // Selected Atom details & AI
  const [selectedAtomName, setSelectedAtomName] = useState<string>('ethereum');
  const [aiReport, setAiReport] = useState<AIConsensus | null>(null);
  const [isExplaining, setIsExplaining] = useState(false);
  const [graphIntelligence, setGraphIntelligence] = useState<GraphIntelligence | null>(null);
  const [isIntelligenceLoading, setIsIntelligenceLoading] = useState(false);

  // Sync state
  const [isSyncing, setIsSyncing] = useState(false);
  const [syncStatus, setSyncStatus] = useState<string | null>(null);

  async function triggerIntuitionSync() {
    setIsSyncing(true);
    setSyncStatus('Initiating handshake with Intuition Mainnet (Base L2)...');
    try {
      const response = await fetch('/api/sync-intuition', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        }
      }).then(r => r.json());

      if (response.success && response.stats) {
        const stats = response.stats;
        setSyncStatus(`Synced: ${stats.atomsSynced} Atoms & ${stats.claimsSynced} Claims via ${stats.endpointUsed} ${stats.isFallback ? '(Cached Buffer)' : ''}`);
        await loadData();
      } else {
        setSyncStatus('Failed to sync with Intuition Mainnet nodes.');
      }
    } catch (err: any) {
      console.error(err);
      setSyncStatus('Network error synchronizing with Intuition Mainnet.');
    } finally {
      setIsSyncing(false);
      setTimeout(() => {
        setSyncStatus(null);
      }, 7000);
    }
  }

  // Bot Simulator
  const [chatLog, setChatLog] = useState<ChatMessage[]>([
    {
      sender: 'bot',
      text: `🤖 *Welcome to the TrustGraph interactive simulator!* \n\nType commands in the input field below to interact with the underlying ledger in real-time, matching standard **Telegram Bot API commands**:\n\n• \`/start\` — Learn about the TrustGraph architecture\n• \`/attest <entity> <score 1-5> <comment>\` — Stake a trust claim (Triple)\n• \`/trust <entity>\` — Request consensus & call **Gemini AI Analysis**\n• \`/graph <entity>\` — Trace connection triples\n• \`/entities\` — Rank registered ledger atoms`,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    }
  ]);
  const [chatInput, setChatInput] = useState('');
  const [simulatorUser, setSimulatorUser] = useState('SatoshiTester');
  const [isBotTyping, setIsBotTyping] = useState(false);

  // Form Submissions
  const [createAtomForm, setCreateAtomForm] = useState({
    displayName: '',
    type: 'project' as 'user' | 'project' | 'wallet',
    description: ''
  });
  const [createAttForm, setCreateAttForm] = useState({
    fromUser: 'WebPioneer',
    toEntity: 'ethereum',
    trustScore: 5,
    comment: 'Superb community coordination and open security'
  });

  const chatEndRef = useRef<HTMLDivElement>(null);

  // Initialize and load
  async function loadData() {
    try {
      const atomsRes = await fetch('/api/atoms').then(r => r.json());
      const attestationsRes = await fetch('/api/attestations').then(r => r.json());
      const statsRes = await fetch('/api/statistics').then(r => r.json());
      const graphRes = await fetch('/api/graph').then(r => r.json());

      if (atomsRes.success) setAtoms(atomsRes.atoms);
      if (attestationsRes.success) setAttestations(attestationsRes.attestations);
      if (statsRes) setStats(statsRes);
      
      if (graphRes.success) {
        // Arrange graph nodes in concentric circles to look incredibly scientific and beautiful
        const arrangedNodes = arrangeNodesScientifically(graphRes.nodes);
        setGraphNodes(arrangedNodes);
        setGraphLinks(graphRes.links);
      }
    } catch (err) {
      console.error('Error loading API data', err);
    }
  }

  // concentric physics/placement solver
  function arrangeNodesScientifically(nodes: GraphNode[]): GraphNode[] {
    const arranged = [...nodes];
    const atoms = arranged.filter(n => n.type !== 'user');
    const users = arranged.filter(n => n.type === 'user');

    const width = 600;
    const height = 450;
    const cx = width / 2;
    const cy = height / 2;

    // Place core atoms on an inner orbit circle
    const innerRadius = 110;
    atoms.forEach((node, i) => {
      const angle = (i / atoms.length) * 2 * Math.PI - Math.PI / 2;
      node.x = cx + innerRadius * Math.cos(angle);
      node.y = cy + innerRadius * Math.sin(angle);
    });

    // Place general peer users on an outer concentric orbit circle
    const outerRadius = 190;
    users.forEach((node, i) => {
      // Offset starting angle to weave nicely
      const angle = (i / (users.length || 1)) * 2 * Math.PI + Math.PI / 4;
      node.x = cx + outerRadius * Math.cos(angle);
      node.y = cy + outerRadius * Math.sin(angle);
    });

    return arranged;
  }

  useEffect(() => {
    loadData();
  }, []);

  // Sync AI reports whenever selected Atom changes
  useEffect(() => {
    if (selectedAtomName) {
      fetchAiExplanation(selectedAtomName);
      fetchGraphIntelligence(selectedAtomName);
    }
  }, [selectedAtomName, atoms]);

  useEffect(() => {
    // Scroll chat window to bottom
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chatLog, isBotTyping]);

  const fetchGraphIntelligence = async (name: string) => {
    setIsIntelligenceLoading(true);
    try {
      const res = await fetch(`/api/intelligence/${encodeURIComponent(name.toLowerCase())}`).then(r => {
        if (!r.ok) {
          throw new Error(`Server returned status ${r.status}`);
        }
        return r.json();
      });
      if (res && res.success && res.intelligence) {
        setGraphIntelligence(res.intelligence);
      } else {
        throw new Error(res?.error || 'Database did not return intelligence data');
      }
    } catch (err) {
      console.error('Error fetching graph intelligence, using local fallback:', err);
      // Construct a beautiful frontend fallback to guarantee consistent data loading
      const targetAtom = atoms.find(a => a.name === name.toLowerCase());
      const displayName = targetAtom ? targetAtom.displayName : name;
      const relatedAtts = attestations.filter(a => a.to_entity === name.toLowerCase());
      
      const sum = relatedAtts.reduce((acc, c) => acc + c.trust_score, 0);
      const averageAvg = relatedAtts.length > 0 ? parseFloat((sum / relatedAtts.length).toFixed(1)) : 3.0;

      let riskScore = 15;
      const riskFactors: string[] = [];
      if (relatedAtts.length === 0) {
        riskScore = 50;
        riskFactors.push("No direct trust attestations have been registered or verified for this atom.");
      } else {
        if (relatedAtts.length === 1) {
          riskScore += 30;
          riskFactors.push("Absolute centralization: only a single unique stakeholder of trust exists.");
        } else if (relatedAtts.length === 2) {
          riskScore += 15;
          riskFactors.push("Slight centralization: only 2 unique stakeholders have rated this node.");
        }
        if (averageAvg < 3) {
          riskScore += 25;
          riskFactors.push("Low average reputation score indicates consensus trust concerns.");
        }
      }
      if (riskFactors.length === 0) {
        riskFactors.push("Consensus signatures are well-distributed with zero anomalous triggers.");
      }

      const confScore = Math.min(100, Math.max(10, 10 + relatedAtts.length * 15 + Math.round(averageAvg * 10)));
      const confLevel: 'Low' | 'Medium' | 'High' = confScore > 75 ? 'High' : (confScore >= 40 ? 'Medium' : 'Low');

      setGraphIntelligence({
        entityName: displayName,
        weightedScore: averageAvg,
        riskScore,
        riskFactors,
        confidenceScore: confScore,
        confidenceLevel: confLevel,
        topInfluencingNodes: relatedAtts.slice(0, 3).map(a => ({
          id: a.from_user.toLowerCase(),
          name: `@${a.from_user}`,
          type: 'user',
          strength: 1.0
        })),
        indirectPaths: relatedAtts.map(a => ({
          path: [a.from_user, displayName],
          score: a.trust_score,
          influence: 1.0
        }))
      });
    } finally {
      setIsIntelligenceLoading(false);
    }
  };

  const fetchAiExplanation = async (name: string) => {
    setIsExplaining(true);
    try {
      const res = await fetch('/api/ai-explain', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ entityName: name })
      }).then(r => {
        if (!r.ok) {
          throw new Error(`Server returned status ${r.status}`);
        }
        return r.json();
      });

      if (res && res.success && res.explanation) {
        setAiReport(res.explanation);
      } else {
        throw new Error(res?.error || 'Server did not return a successful AI explanation');
      }
    } catch (err) {
      console.error('Failed to load AI breakdown, using local fallback:', err);
      // Construct an elegant client-side heuristic fallback so the UI never displays as empty or broken
      const targetAtom = atoms.find(a => a.name === name.toLowerCase());
      const displayName = targetAtom ? targetAtom.displayName : name;
      const relatedAtts = attestations.filter(a => a.to_entity === name.toLowerCase());
      const count = relatedAtts.length;
      
      const sum = relatedAtts.reduce((acc, current) => acc + current.trust_score, 0);
      const average = count > 0 ? parseFloat((sum / count).toFixed(1)) : 3.0;

      const riskSignalsHeuristic: string[] = [];
      if (average < 3) {
        riskSignalsHeuristic.push('Low overall feedback score implies active trust concerns in the community.');
      }
      if (count < 3) {
        riskSignalsHeuristic.push('Very low participation level limits statistical reputation consensus.');
      }
      const scoreVariance = count > 1 ? 
        Math.max(...relatedAtts.map(a => a.trust_score)) - Math.min(...relatedAtts.map(a => a.trust_score)) : 0;
      if (scoreVariance >= 3) {
        riskSignalsHeuristic.push('Polarized ratings indicate divided staker trust layers.');
      }

      let confidence: 'Low' | 'Medium' | 'High' = 'Low';
      if (count >= 5) confidence = 'High';
      else if (count >= 3) confidence = 'Medium';

      const summaryHeuristic = `Based on ${count} community attestation${count === 1 ? '' : 's'}, ${displayName} maintains an average trust rating of ${average}/5. ${
        average >= 4 ? 'The consensus is highly favorable, highlighting active reliability and positive stakeholder relationships.' :
        average >= 3 ? 'The entity displays stable reputation signals with moderate trust scores but is subject to occasional critical reviews.' :
        'Reputation signals reflect severe trust concerns or negative feedback that requires caution.'
      }`;

      setAiReport({
        entityName: displayName,
        summary: summaryHeuristic,
        riskSignals: riskSignalsHeuristic.length > 0 ? riskSignalsHeuristic : ['No critical risk signals flagged by the community.'],
        confidenceLevel: confidence,
        trustScore: average,
        totalClaims: count
      });
    } finally {
      setIsExplaining(false);
    }
  };

  // Submit atom fast
  const handleCreateAtom = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!createAtomForm.displayName) return;

    try {
      const res = await fetch('/api/atoms', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          displayName: createAtomForm.displayName,
          type: createAtomForm.type,
          description: createAtomForm.description,
          creator: 'dashboard-ui'
        })
      }).then(r => r.json());

      if (res.success) {
        setCreateAtomForm({ displayName: '', type: 'project', description: '' });
        setSelectedAtomName(res.atom.name);
        await loadData();
      }
    } catch (err) {
      console.error(err);
    }
  };

  // Submit attestation fast
  const handleCreateAttestation = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const res = await fetch('/api/attestations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from_user: createAttForm.fromUser,
          to_entity: createAttForm.toEntity,
          trust_score: createAttForm.trustScore,
          comment: createAttForm.comment
        })
      }).then(r => r.json());

      if (res.success) {
        setCreateAttForm({
          ...createAttForm,
          comment: ''
        });
        setSelectedAtomName(createAttForm.toEntity);
        // Refresh
        await loadData();
      }
    } catch (err) {
      console.error(err);
    }
  };

  // Sending bot input through simulator command console
  const handleSendChat = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!chatInput.trim()) return;

    const userText = chatInput.trim();
    // Add User bubble
    setChatLog(prev => [...prev, {
      sender: 'user',
      text: userText,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    }]);
    setChatInput('');
    setIsBotTyping(true);

    try {
      const res = await fetch('/api/bot/simulate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: userText,
          fromUser: simulatorUser
        })
      }).then(r => r.json());

      setTimeout(() => {
        setIsBotTyping(false);
        if (res.success) {
          setChatLog(prev => [...prev, {
            sender: 'bot',
            text: res.reply,
            timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
          }]);
          loadData(); // Re-sync any atoms or links updated via chat command!
        }
      }, 700);

    } catch (err) {
      setIsBotTyping(false);
      console.error(err);
    }
  };

  // Helper to pre-populate custom commands
  const triggerDemoCommand = (cmd: string) => {
    setChatInput(cmd);
  };

  // Filter atoms list
  const filteredAtoms = atoms.filter(atom => {
    const matchesSearch = atom.displayName.toLowerCase().includes(searchQuery.toLowerCase()) || 
                          atom.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
                          atom.description.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesType = filterType === 'all' || atom.type === filterType;
    return matchesSearch && matchesType;
  });

  return (
    <div className="min-h-screen bg-[#0A0A0A] text-[#F5F2ED] font-serif flex flex-col selection:bg-[#F5F2ED]/20 selection:text-[#F5F2ED]">
      
      {/* Absolute Header Branding */}
      <header className="border-b border-[#F5F2ED]/20 bg-[#0A0A0A]/95 backdrop-blur-md sticky top-0 z-50 px-8 py-6 flex flex-col lg:flex-row lg:items-baseline justify-between gap-6">
        <div className="flex flex-col">
          <span className="text-[10px] uppercase tracking-[0.3em] font-sans text-[#F5F2ED]/50 mb-1.5">Conceptual Reputation System</span>
          <h1 className="text-4xl font-light tracking-tighter italic font-serif text-[#F5F2ED]">
            TrustGraph <span className="font-sans not-italic text-xs tracking-[0.4em] ml-4 font-bold border border-[#F5F2ED]/20 px-3 py-1 bg-[#F5F2ED]/5">V1.0</span>
          </h1>
        </div>

        {/* Navigation Controls */}
        <div className="flex flex-wrap items-center gap-2 p-1 bg-[#F5F2ED]/5 border border-[#F5F2ED]/10 rounded-none">
          <button 
            onClick={() => setActiveTab('graph')}
            className={`px-4 py-2 text-xs font-sans uppercase tracking-[0.2em] transition-all duration-200 flex items-center gap-2 rounded-none cursor-pointer ${
              activeTab === 'graph' 
                ? 'bg-[#F5F2ED] text-[#0A0A0A] font-bold' 
                : 'text-[#F5F2ED]/60 hover:text-[#F5F2ED]'
            }`}
          >
            <GitFork className="h-3.5 w-3.5" />
            Visual Trust Graph
          </button>
          <button 
            onClick={() => setActiveTab('ledger')}
            className={`px-4 py-2 text-xs font-sans uppercase tracking-[0.2em] transition-all duration-200 flex items-center gap-2 rounded-none cursor-pointer ${
              activeTab === 'ledger' 
                ? 'bg-[#F5F2ED] text-[#0A0A0A] font-bold' 
                : 'text-[#F5F2ED]/60 hover:text-[#F5F2ED]'
            }`}
          >
            <Database className="h-3.5 w-3.5" />
            Ledger Registries
          </button>
          <button 
            onClick={() => setActiveTab('simulator')}
            className={`px-4 py-2 text-xs font-sans uppercase tracking-[0.2em] transition-all duration-200 flex items-center gap-2 rounded-none cursor-pointer ${
              activeTab === 'simulator' 
                ? 'bg-[#F5F2ED] text-[#0A0A0A] font-bold' 
                : 'text-[#F5F2ED]/60 hover:text-[#F5F2ED]'
            }`}
          >
            <Bot className="h-3.5 w-3.5" />
            TG Bot Emulator
          </button>
        </div>

        {/* Real-time Indicator status */}
        <div className="hidden sm:flex items-center gap-4">
          <div className="text-right">
            <span className="text-[10px] uppercase tracking-[0.2em] font-sans text-[#F5F2ED]/40">Intuition Protocol</span>
            <div className="flex items-center justify-end gap-2 text-emerald-400 mt-0.5">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse"></span>
              <span className="font-sans text-[10px] tracking-[0.2em] uppercase font-bold">Mainnet Connected</span>
            </div>
          </div>
          <button 
            onClick={triggerIntuitionSync}
            disabled={isSyncing}
            className={`px-3 py-2 bg-[#F5F2ED]/5 hover:bg-[#F5F2ED]/10 border border-[#F5F2ED]/25 transition-all text-xs font-sans uppercase tracking-wider flex items-center gap-2 text-[#F5F2ED] rounded-none cursor-pointer ${isSyncing ? 'opacity-70 cursor-not-allowed' : ''}`}
            title="Sync live Atoms and Claims from Intuition Mainnet indexing gateway"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${isSyncing ? 'animate-spin' : ''}`} />
            {isSyncing ? 'Syncing...' : 'Sync Mainnet'}
          </button>
        </div>
      </header>

      {/* Sync Status Banner */}
      {syncStatus && (
        <div className="bg-[#F5F2ED] text-[#0A0A0A] px-8 py-3 text-xs font-sans tracking-wider flex items-center gap-3 border-b border-[#F5F2ED]/30 animate-pulse">
          <Radio className="h-4 w-4 text-emerald-600 animate-ping" />
          <span className="font-bold">MAINNET INTEGRATION:</span>
          <span>{syncStatus}</span>
        </div>
      )}

      {/* Main Grid Panels */}
      <main className="flex-1 w-full max-w-[1700px] mx-auto p-4 sm:p-6 lg:p-12 grid grid-cols-1 xl:grid-cols-12 gap-12">
        
        {/* Left Side: Ledger Summary and Custom Transaction Forms (4 Columns) */}
        <div className="xl:col-span-4 flex flex-col gap-8">
          
          {/* Dashboard Statistics Widget */}
          <div className="bg-[#F5F2ED]/5 border border-[#F5F2ED]/10 p-6 rounded-none relative overflow-hidden">
            <div className="absolute top-0 right-0 h-32 w-32 bg-[#F5F2ED]/2 rounded-full blur-[45px] pointer-events-none"></div>
            
            <h2 className="text-xs uppercase tracking-[0.2em] font-sans text-[#F5F2ED]/40 border-b border-[#F5F2ED]/10 pb-2 mb-4 flex items-center gap-2">
              <Sliders className="h-3.5 w-3.5 text-[#F5F2ED]" />
              System Architecture Metrics
            </h2>

            <div className="grid grid-cols-2 gap-4">
              <div className="p-4 border border-[#F5F2ED]/10 bg-[#0A0A0A]/40 rounded-none">
                <p className="text-[10px] uppercase tracking-[0.15em] text-[#F5F2ED]/40 font-sans">Total Atoms</p>
                <p className="text-3xl font-light font-serif text-[#F5F2ED] mt-1">{stats.totalAtoms}</p>
                <div className="mt-2 flex items-center gap-1.5 text-[9px] text-[#F5F2ED]/60 font-sans uppercase tracking-widest">
                  <Database className="h-3 w-3 text-[#F5F2ED]/50" /> Identity Units
                </div>
              </div>
              <div className="p-4 border border-[#F5F2ED]/10 bg-[#0A0A0A]/40 rounded-none">
                <p className="text-[10px] uppercase tracking-[0.15em] text-[#F5F2ED]/40 font-sans">Relations</p>
                <p className="text-3xl font-light font-serif text-[#F5F2ED] mt-1">{stats.totalAttestations}</p>
                <div className="mt-2 flex items-center gap-1.5 text-[9px] text-[#F5F2ED]/60 font-sans uppercase tracking-widest">
                  <GitFork className="h-3 w-3 text-[#F5F2ED]/50" /> Signed Triples
                </div>
              </div>
              <div className="p-4 border border-[#F5F2ED]/10 bg-[#0A0A0A]/40 rounded-none">
                <p className="text-[10px] uppercase tracking-[0.15em] text-[#F5F2ED]/40 font-sans">Active Stakers</p>
                <p className="text-3xl font-light font-serif text-[#F5F2ED] mt-1">{stats.totalUsers}</p>
                <div className="mt-2 flex items-center gap-1.5 text-[9px] text-[#F5F2ED]/60 font-sans uppercase tracking-widest">
                  <User className="h-3 w-3 text-[#F5F2ED]/50" /> Peer Nodes
                </div>
              </div>
              <div className="p-4 border border-[#F5F2ED]/10 bg-[#0A0A0A]/40 rounded-none">
                <p className="text-[10px] uppercase tracking-[0.15em] text-[#F5F2ED]/40 font-sans">Reputation Weight</p>
                <p className="text-3xl font-light font-serif text-emerald-400 mt-1">{stats.averageConsensusScore} <span className="text-xs text-[#F5F2ED]/40 font-normal">/5</span></p>
                <div className="mt-2 flex items-center gap-1.5 text-[9px] text-emerald-400/80 font-sans uppercase tracking-widest">
                  <ShieldCheck className="h-3 w-3" /> Consensus Fit
                </div>
              </div>
            </div>
          </div>

          {/* Atom Forge - Quick manually write entities */}
          <div className="bg-[#F5F2ED]/5 border border-[#F5F2ED]/10 p-6 rounded-none">
            <h2 className="text-xs uppercase tracking-[0.2em] font-sans text-[#F5F2ED]/40 border-b border-[#F5F2ED]/10 pb-2 mb-4 flex items-center gap-2">
              <PlusCircle className="h-4 w-4" />
              Register Identity Atom
            </h2>
            <p className="text-xs text-[#F5F2ED]/60 mb-4 font-sans uppercase tracking-wider leading-relaxed">
              Manually map a decentralized smart contract, node, or project onto the cryptographic trust graph directory.
            </p>

            <form onSubmit={handleCreateAtom} className="space-y-4 font-sans">
              <div>
                <label className="block text-[10px] uppercase tracking-widest text-[#F5F2ED]/50 mb-1">Atom Unique Label</label>
                <input 
                  type="text"
                  placeholder="e.g. Aave Protocol, Vitalik Wallet"
                  value={createAtomForm.displayName}
                  onChange={(e) => setCreateAtomForm({...createAtomForm, displayName: e.target.value})}
                  required
                  className="w-full bg-[#0A0A0A] border border-[#F5F2ED]/20 rounded-none px-3 py-2 text-xs focus:outline-none focus:border-[#F5F2ED]/50 text-[#F5F2ED] placeholder-[#F5F2ED]/25 font-serif"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[10px] uppercase tracking-widest text-[#F5F2ED]/50 mb-1">Entity Class</label>
                  <select 
                    value={createAtomForm.type}
                    onChange={(e) => setCreateAtomForm({...createAtomForm, type: e.target.value as any})}
                    className="w-full bg-[#0A0A0A] border border-[#F5F2ED]/25 rounded-none px-3 py-2 text-xs focus:outline-none focus:border-[#F5F2ED]/50 text-[#F5F2ED] font-sans uppercase tracking-widest"
                  >
                    <option value="project" className="bg-[#0A0A0A]">Project / DApp</option>
                    <option value="wallet" className="bg-[#0A0A0A]">Wallet Address</option>
                    <option value="user" className="bg-[#0A0A0A]">User Identity</option>
                  </select>
                </div>
                <div>
                  <label className="block text-[10px] uppercase tracking-widest text-[#F5F2ED]/50 mb-1">Origin Node</label>
                  <input 
                    type="text" 
                    readOnly 
                    value="WEB-DASHBOARD" 
                    className="w-full bg-[#0A0A0A] border border-[#F5F2ED]/10 rounded-none px-3 py-2 text-xs text-[#F5F2ED]/20 font-sans tracking-wider cursor-not-allowed select-none"
                  />
                </div>
              </div>

              <div>
                <label className="block text-[10px] uppercase tracking-widest text-[#F5F2ED]/50 mb-1">Direct Semantic Proof</label>
                <input 
                  type="text"
                  placeholder="Summary of entities or description..."
                  value={createAtomForm.description}
                  onChange={(e) => setCreateAtomForm({...createAtomForm, description: e.target.value})}
                  className="w-full bg-[#0A0A0A] border border-[#F5F2ED]/20 rounded-none px-3 py-2 text-xs focus:outline-none focus:border-[#F5F2ED]/50 text-[#F5F2ED] placeholder-[#F5F2ED]/25 font-serif"
                />
              </div>

              <button 
                type="submit"
                className="w-full bg-[#F5F2ED] hover:bg-[#F5F2ED]/85 text-[#0A0A0A] border-none py-3 px-4 text-xs font-sans font-bold uppercase tracking-[0.2em] transition-all duration-200 flex items-center justify-center gap-2 cursor-pointer rounded-none"
              >
                <PlusCircle className="h-4 w-4 shrink-0" />
                Register Atom to Graph
              </button>
            </form>
          </div>

          {/* Attestation Engine manually adding */}
          <div className="bg-[#F5F2ED]/5 border border-[#F5F2ED]/10 p-6 rounded-none">
            <h2 className="text-xs uppercase tracking-[0.2em] font-sans text-[#F5F2ED]/40 border-b border-[#F5F2ED]/10 pb-2 mb-4 flex items-center gap-2">
              <Award className="h-4 w-4" />
              Commit Trust Attestation
            </h2>
            <p className="text-xs text-[#F5F2ED]/60 mb-4 font-sans uppercase tracking-wider leading-relaxed">
              Decentrally stake trust credentials. Attache signed confidence signals linking nodes together.
            </p>

            <form onSubmit={handleCreateAttestation} className="space-y-4 font-sans">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[10px] uppercase tracking-widest text-[#F5F2ED]/50 mb-1">Citizen Stakeholder</label>
                  <div className="relative">
                    <span className="absolute left-3 top-2 text-[#F5F2ED]/30 text-xs font-mono font-bold">@</span>
                    <input 
                      type="text" 
                      required
                      placeholder="CryptoCoder"
                      value={createAttForm.fromUser}
                      onChange={(e) => setCreateAttForm({...createAttForm, fromUser: e.target.value})}
                      className="w-full bg-[#0A0A0A] border border-[#F5F2ED]/20 rounded-none pl-7 pr-3 py-2 text-xs focus:outline-none focus:border-[#F5F2ED]/50 text-[#F5F2ED] placeholder-[#F5F2ED]/25 font-serif"
                    />
                  </div>
                </div>
                <div>
                  <label className="block text-[10px] uppercase tracking-widest text-[#F5F2ED]/50 mb-1">Target Subject Node</label>
                  <select 
                    value={createAttForm.toEntity}
                    onChange={(e) => setCreateAttForm({...createAttForm, toEntity: e.target.value})}
                    className="w-full bg-[#0A0A0A] border border-[#F5F2ED]/25 rounded-none px-2.5 py-2 text-xs focus:outline-none focus:border-[#F5F2ED]/50 text-[#F5F2ED] font-sans uppercase tracking-widest"
                  >
                    {atoms.map(a => (
                      <option key={a.id} value={a.name} className="bg-[#0A0A0A]">{a.displayName}</option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-[10px] uppercase tracking-widest text-[#F5F2ED]/50 mb-1 flex justify-between">
                  <span>Reputation Signal Weight</span>
                  <span className="text-emerald-400 font-bold">{createAttForm.trustScore} / 5</span>
                </label>
                <input 
                  type="range" 
                  min="1" 
                  max="5"
                  value={createAttForm.trustScore}
                  onChange={(e) => setCreateAttForm({...createAttForm, trustScore: parseInt(e.target.value)})}
                  className="w-full accent-[#F5F2ED] cursor-pointer h-1.5 bg-[#0A0A0A] border border-[#F5F2ED]/10 rounded-none my-2"
                />
                <div className="flex justify-between text-[8px] text-[#F5F2ED]/40 font-mono tracking-tight">
                  <span>1 (Untrusted / Risk)</span>
                  <span>3 (Neutral)</span>
                  <span>5 (Highly Sovereign)</span>
                </div>
              </div>

              <div>
                <label className="block text-[10px] uppercase tracking-widest text-[#F5F2ED]/50 mb-1">Remarks & Performance Proof</label>
                <textarea 
                  placeholder="Share details about performance, security, or signed cryptographic audit metrics..."
                  value={createAttForm.comment}
                  onChange={(e) => setCreateAttForm({...createAttForm, comment: e.target.value})}
                  required
                  rows={2}
                  className="w-full bg-[#0A0A0A] border border-[#F5F2ED]/20 rounded-none px-3 py-2 text-xs focus:outline-none focus:border-[#F5F2ED]/50 text-[#F5F2ED] placeholder-[#F5F2ED]/25 font-serif leading-relaxed resize-none"
                />
              </div>

              <button 
                type="submit"
                className="w-full bg-[#F5F2ED] hover:bg-[#F5F2ED]/85 text-[#0A0A0A] border-none py-3 px-4 text-xs font-sans font-bold uppercase tracking-[0.2em] transition-all duration-200 flex items-center justify-center gap-2 cursor-pointer rounded-none"
              >
                <Award className="h-4 w-4 shrink-0" />
                Commit Claim Triple (Attest)
              </button>
            </form>
          </div>

        </div>

        {/* Right Side / Workspace viewport (8 Columns) */}
        <div className="xl:col-span-8 flex flex-col gap-8">
          
          {/*          {activeTab === 'graph' && (
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
              
              {/* Force concentric Graph Panel (7 columns) */}
              <div className="lg:col-span-7 border border-[#F5F2ED]/10 p-6 bg-[#F5F2ED]/2 rounded-none flex flex-col justify-between relative min-h-[480px]">
                <div>
                  <h2 className="text-xs uppercase tracking-[0.2em] font-sans text-[#F5F2ED]/40 border-b border-[#F5F2ED]/10 pb-2 mb-4 flex items-center gap-2">
                    <GitFork className="h-4 w-4 text-[#F5F2ED]" />
                    Decentralized Identity Trust Map
                  </h2>
                  <p className="text-xs text-[#F5F2ED]/60 font-sans tracking-wide mt-1">Concentric hierarchy mapping Citizen Stakeholders (outer) backing registered Atoms (inner).</p>
                </div>

                {/* Graph Area */}
                <div className="flex-1 my-6 flex items-center justify-center relative bg-[#0A0A0A] border border-[#F5F2ED]/10 rounded-none overflow-hidden min-h-[340px]">
                  
                  {/* Floating Legend */}
                  <div className="absolute top-3 left-3 bg-[#0A0A0A]/95 border border-[#F5F2ED]/20 px-4 py-3 rounded-none text-[9px] font-sans leading-relaxed space-y-2 pointer-events-none shadow-2xl">
                    <p className="text-[#F5F2ED]/40 uppercase tracking-widest text-[8px] mb-1 font-bold">Orbit Classification</p>
                    <div className="flex items-center gap-2">
                      <span className="h-2.5 w-2.5 rounded-none bg-[#F5F2ED]"></span>
                      <span className="text-[#F5F2ED]/80 uppercase tracking-wider">Project / DApp Atom</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="h-2.5 w-2.5 rounded-none bg-[#C5A880]"></span>
                      <span className="text-[#F5F2ED]/80 uppercase tracking-wider">Wallet Address</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="h-2.5 w-2.5 rounded-none bg-[#8C92AC]"></span>
                      <span className="text-[#F5F2ED]/80 uppercase tracking-wider">User Identity</span>
                    </div>
                  </div>

                  {/* SVG Drawing Canvas */}
                  {graphNodes.length === 0 ? (
                    <div className="text-center font-sans tracking-widest text-xs text-[#F5F2ED]/30 uppercase">
                      No matching graph identities to render.
                    </div>
                  ) : (
                    <svg className="w-full h-full min-h-[340px] select-none" viewBox="0 0 600 450">
                      
                      {/* Connection Links */}
                      {graphLinks.map((link, idx) => {
                        const srcNode = graphNodes.find(n => n.id === link.source);
                        const tgtNode = graphNodes.find(n => n.id === link.target);
                        if (!srcNode || !tgtNode) return null;

                        const isHighlighted = hoveredNode === link.source || hoveredNode === link.target;
                        const defaultOpacity = hoveredNode ? 0.05 : 0.2;

                        // Editorial Color strength mapping
                        let strokeColor = 'rgba(197, 168, 128, 1)'; // amber/gold
                        if (link.score >= 4) strokeColor = 'rgba(245, 242, 237, 1)'; // cream/ivory
                        else if (link.score < 3) strokeColor = 'rgba(140, 146, 172, 1)'; // muted slate-blue

                        return (
                          <g key={idx}>
                            <line
                              x1={srcNode.x}
                              y1={srcNode.y}
                              x2={tgtNode.x}
                              y2={tgtNode.y}
                              stroke={isHighlighted ? strokeColor : 'rgba(245, 242, 237, 0.4)'}
                              strokeWidth={isHighlighted ? 2.5 : 1.0}
                              strokeOpacity={isHighlighted ? 0.95 : defaultOpacity}
                              className="transition-all duration-200"
                            />
                            {/* Visual directional arrow dot midpath */}
                            <circle
                              cx={(srcNode.x! + tgtNode.x!) / 2}
                              cy={(srcNode.y! + tgtNode.y!) / 2}
                              r={isHighlighted ? 3 : 1.5}
                              fill={isHighlighted ? strokeColor : 'rgba(245, 242, 237, 0.2)'}
                              opacity={isHighlighted ? 0.95 : defaultOpacity}
                            />
                          </g>
                        );
                      })}

                      {/* Indirect Path Links for Selected Atom Node */}
                      {selectedAtomName && graphIntelligence && graphIntelligence.indirectPaths && (
                        <g>
                          {graphIntelligence.indirectPaths.map((indPath, pIdx) => {
                            const nodeSeq = indPath.path;
                            const segments: { fromNode: GraphNode; toNode: GraphNode; weight: number }[] = [];
                            
                            for (let i = 0; i < nodeSeq.length - 1; i++) {
                              const fromId = parsePathNodeToId(nodeSeq[i], graphNodes);
                              const toId = parsePathNodeToId(nodeSeq[i+1], graphNodes);
                              const fromNode = graphNodes.find(n => n.id === fromId);
                              const toNode = graphNodes.find(n => n.id === toId);
                              
                              if (fromNode && toNode) {
                                segments.push({ fromNode, toNode, weight: indPath.influence });
                              }
                            }

                            return segments.map((seg, sIdx) => {
                              const isHoveredSegment = hoveredNode === seg.fromNode.id || hoveredNode === seg.toNode.id;
                              const isMultiHop = nodeSeq.length > 2;

                              return (
                                <g key={`ind-p-${pIdx}-s-${sIdx}`}>
                                  {/* Dotted highlighted line with custom dashes */}
                                  <line
                                    x1={seg.fromNode.x}
                                    y1={seg.fromNode.y}
                                    x2={seg.toNode.x}
                                    y2={seg.toNode.y}
                                    stroke={isMultiHop ? '#C5A880' : 'rgba(245, 242, 237, 0.85)'}
                                    strokeWidth={isHoveredSegment ? 3.5 : (isMultiHop ? 2.0 : 1.5)}
                                    strokeDasharray={isMultiHop ? "5,3" : "2,2"}
                                    strokeOpacity={isHoveredSegment ? 1.0 : 0.75}
                                    className="transition-all duration-300"
                                  />
                                  {/* Glowing background path for multi-hop */}
                                  {isMultiHop && (
                                    <line
                                      x1={seg.fromNode.x}
                                      y1={seg.fromNode.y}
                                      x2={seg.toNode.x}
                                      y2={seg.toNode.y}
                                      stroke="#C5A880"
                                      strokeWidth={isHoveredSegment ? 10 : 6}
                                      strokeOpacity={isHoveredSegment ? 0.3 : 0.15}
                                      className="pointer-events-none transition-all duration-300"
                                    />
                                  )}
                                </g>
                              );
                            });
                          })}
                        </g>
                      )}

                      {/* Nodes Circles overlay */}
                      {graphNodes.map((node) => {
                        const isMainHighlighted = hoveredNode === node.id;
                        const isDimmed = hoveredNode && hoveredNode !== node.id && 
                          !graphLinks.some(l => (l.source === node.id && l.target === hoveredNode) || (l.target === node.id && l.source === hoveredNode));
                        
                        // Editorial Color Selection
                        let color = '#8C92AC'; 
                        if (node.type === 'project') color = '#F5F2ED'; 
                        else if (node.type === 'wallet') color = '#C5A880'; 
                        else if (node.type === 'user') color = '#8C92AC'; 

                        const nodeRadius = node.type === 'user' ? 8 : 13;

                        return (
                          <g 
                            key={node.id}
                            className="cursor-pointer transition-all duration-300"
                            onMouseEnter={() => setHoveredNode(node.id)}
                            onMouseLeave={() => setHoveredNode(null)}
                            onClick={() => {
                              if (node.type !== 'user') {
                                setSelectedAtomName(node.id);
                              } else {
                                const target = graphLinks.find(l => l.source === node.id)?.target;
                                if (target) setSelectedAtomName(target);
                              }
                            }}
                          >
                            {/* Orbit pulse halo */}
                            <circle
                              cx={node.x}
                              cy={node.y}
                              r={nodeRadius + (isMainHighlighted ? 5 : 2)}
                              fill="none"
                              stroke={color}
                              strokeWidth={1}
                              strokeOpacity={isMainHighlighted ? 0.8 : 0.15}
                              className="transition-all duration-200"
                            />

                            {/* Core Inner Bubble */}
                            <circle
                              cx={node.x}
                              cy={node.y}
                              r={nodeRadius}
                              fill="#0A0A0A"
                              stroke={color}
                              strokeWidth={2}
                              opacity={isDimmed ? 0.2 : 1}
                              className="transition-all duration-250"
                            />

                            {/* Numeric Score indicator overlay for high-trust Atoms */}
                            {node.type !== 'user' && node.score !== undefined && node.score > 0 && (
                              <text
                                x={node.x}
                                y={node.y! + 3}
                                textAnchor="middle"
                                fill="#F5F2ED"
                                fontSize="8"
                                fontWeight="bold"
                                opacity={isDimmed ? 0.2 : 0.9}
                                className="font-sans pointer-events-none"
                              >
                                {node.score.toFixed(0)}
                              </text>
                            )}

                            {/* Node text tags dynamic adjustment layout */}
                            <text
                              x={node.x}
                              y={node.y! + nodeRadius + 14}
                              textAnchor="middle"
                              fill={isMainHighlighted ? '#F5F2ED' : 'rgba(245, 242, 237, 0.6)'}
                              fontSize={isMainHighlighted ? '10' : '9'}
                              fontWeight={isMainHighlighted ? 'bold' : 'normal'}
                              opacity={isDimmed ? 0.2 : 0.9}
                              className="font-sans pointer-events-none bg-[#0A0A0A]"
                            >
                              {node.label}
                            </text>
                          </g>
                        );
                      })}

                    </svg>
                  )}
                </div>

                {/* Micro instructions feedback block */}
                <div className="border border-[#F5F2ED]/10 p-4 bg-[#F5F2ED]/2 rounded-none flex gap-3 items-center text-xs text-[#F5F2ED]/60 font-sans tracking-wide">
                  <HelpCircle className="h-4 w-4 text-[#F5F2ED]/70 shrink-0" />
                  <span>Interactive node topology. Click a project, address, or staker node to overlay dynamic reputation parameters and run Gemini AI consensus analysis.</span>
                </div>
              </div>

              {/* Advanced AI consensus side panel (5 columns) */}
              <div className="lg:col-span-5 border border-[#F5F2ED]/10 p-6 bg-[#F5F2ED]/2 rounded-none flex flex-col justify-between">
                <div>
                  <div className="flex items-center justify-between mb-4 border-b border-[#F5F2ED]/10 pb-3">
                    <h2 className="text-[#F5F2ED] text-xs uppercase tracking-[0.2em] font-sans flex items-center gap-2">
                      <Sparkles className="h-4 w-4 text-[#C5A880]" />
                      Sovereign AI Evaluation
                    </h2>
                    <span className="text-[9px] border border-emerald-500/30 text-emerald-400 font-sans tracking-widest uppercase px-2 py-0.5 rounded-none bg-emerald-500/5">Active Poller</span>
                  </div>

                  {selectedAtomName ? (
                    <div className="space-y-6">
                      <div className="pb-3 border-b border-[#F5F2ED]/10">
                        <span className="text-[10px] text-[#F5F2ED]/40 uppercase tracking-widest font-sans">Current Subject</span>
                        <h3 className="text-2xl font-light font-serif text-[#F5F2ED] mt-1">
                          {atoms.find(a => a.name === selectedAtomName)?.displayName || selectedAtomName}
                        </h3>
                        {atoms.find(a => a.name === selectedAtomName)?.description && (
                          <p className="text-xs text-[#F5F2ED]/50 italic font-serif mt-2 leading-relaxed">
                            "{atoms.find(a => a.name === selectedAtomName)?.description}"
                          </p>
                        )}
                      </div>

                      {/* Loading status wrapper */}
                      {isExplaining || isIntelligenceLoading ? (
                        <div className="py-16 flex flex-col items-center justify-center gap-3">
                          <RefreshCw className="h-6 w-6 text-[#F5F2ED]/80 animate-spin" />
                          <p className="text-xs font-sans tracking-widest uppercase text-[#F5F2ED]/40">Calculating Graph Intelligence & AI Consensus...</p>
                        </div>
                      ) : (graphIntelligence || aiReport) ? (
                        <div className="space-y-6">
                          
                          {/* Side-by-side Bento Grid Metrics */}
                          {graphIntelligence && (
                            <div className="grid grid-cols-3 gap-3">
                              
                              {/* Propagated Score */}
                              <div className="border border-[#F5F2ED]/10 p-3 bg-[#F5F2ED]/2 flex flex-col items-center text-center justify-between min-h-[95px] rounded-none">
                                <span className="text-[9px] text-[#F5F2ED]/40 uppercase tracking-wider font-sans font-medium">Weighted Trust</span>
                                <div className="my-1 flex flex-col items-center">
                                  <span className="text-lg font-bold text-emerald-400 font-sans flex items-center gap-1 leading-none">
                                    ★ {graphIntelligence.weightedScore.toFixed(1)}
                                  </span>
                                </div>
                                <span className="text-[8px] text-[#F5F2ED]/30 uppercase font-mono leading-none">Multi-Hop Avg</span>
                              </div>

                              {/* Risk Score */}
                              <div className="border border-[#F5F2ED]/10 p-3 bg-[#F5F2ED]/2 flex flex-col items-center text-center justify-between min-h-[95px] rounded-none">
                                <span className="text-[9px] text-[#F5F2ED]/40 uppercase tracking-wider font-sans font-semibold">Risk Index</span>
                                <div className="my-1 flex flex-col items-center w-full px-1">
                                  <span className={`text-lg font-bold font-sans leading-none ${
                                    graphIntelligence.riskScore > 60 ? 'text-rose-400' :
                                    graphIntelligence.riskScore > 30 ? 'text-amber-400' :
                                    'text-emerald-400'
                                  }`}>
                                    {graphIntelligence.riskScore}%
                                  </span>
                                  <div className="w-full bg-[#0A0A0A] h-1 mt-1 rounded-none overflow-hidden">
                                    <div 
                                      className={`h-full ${
                                        graphIntelligence.riskScore > 60 ? 'bg-rose-500' :
                                        graphIntelligence.riskScore > 30 ? 'bg-amber-500' :
                                        'bg-emerald-500'
                                      }`}
                                      style={{ width: `${graphIntelligence.riskScore}%` }}
                                    />
                                  </div>
                                </div>
                                <span className="text-[8px] text-[#F5F2ED]/30 uppercase font-mono leading-none">Sybil & Spam</span>
                              </div>

                              {/* Confidence Score */}
                              <div className="border border-[#F5F2ED]/10 p-3 bg-[#F5F2ED]/2 flex flex-col items-center text-center justify-between min-h-[95px] rounded-none font-sans">
                                <span className="text-[9px] text-[#F5F2ED]/40 uppercase tracking-wider font-sans font-medium">Confidence</span>
                                <div className="my-0.5 flex flex-col items-center">
                                  <span className={`text-lg font-bold leading-none ${
                                    graphIntelligence.confidenceLevel === 'High' ? 'text-emerald-400' :
                                    graphIntelligence.confidenceLevel === 'Medium' ? 'text-amber-400' :
                                    'text-rose-400'
                                  }`}>
                                    {graphIntelligence.confidenceScore}%
                                  </span>
                                  <span className="text-[8px] text-[#F5F2ED]/50 font-sans uppercase font-bold mt-0.5 tracking-wide leading-none">
                                    ({graphIntelligence.confidenceLevel})
                                  </span>
                                </div>
                                <span className="text-[8px] text-[#F5F2ED]/30 uppercase font-mono leading-none">Voter Structure</span>
                              </div>

                            </div>
                          )}

                          {/* Beautiful AI Explanation block */}
                          {aiReport && (
                            <div className="p-5 bg-[#F5F2ED] text-[#0A0A0A] rounded-none shadow-xl border-none">
                              <span className="text-[10px] font-sans text-[#0A0A0A]/50 font-bold uppercase tracking-[0.3em] block mb-2">🤖 AI Explanation Layer</span>
                              <p className="text-sm italic font-serif leading-relaxed text-[#0A0A0A]">
                                "{aiReport.summary}"
                              </p>
                            </div>
                          )}

                          {/* Risk Warnings */}
                          {graphIntelligence && (
                            <div className="bg-[#F5F2ED]/5 border border-[#F5F2ED]/10 p-4 rounded-none">
                              <span className="text-[10px] font-sans text-[#F5F2ED]/50 font-semibold uppercase tracking-widest block mb-2 border-b border-[#F5F2ED]/10 pb-1.5">⚠️ Smart Risk Parameters</span>
                              <div className="space-y-2">
                                {graphIntelligence.riskFactors.map((factor, i) => (
                                  <div key={i} className="flex gap-2 items-start text-xs text-[#F5F2ED]/85 leading-relaxed font-sans">
                                    <AlertTriangle className="h-3.5 w-3.5 text-amber-500 shrink-0 mt-0.5" />
                                    <span>{factor}</span>
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}

                          {/* Top Influencing Nodes */}
                          {graphIntelligence && graphIntelligence.topInfluencingNodes.length > 0 && (
                            <div className="bg-[#F5F2ED]/5 border border-[#F5F2ED]/10 p-4 rounded-none">
                              <span className="text-[10px] font-sans text-[#F5F2ED]/50 font-semibold uppercase tracking-widest block mb-2">🏆 Top Influence Weight</span>
                              <div className="space-y-1.5 font-sans">
                                {graphIntelligence.topInfluencingNodes.map((inf, i) => (
                                  <div key={i} className="flex items-center justify-between text-xs">
                                    <span className="text-[#F5F2ED]/85 flex items-center gap-1.5">
                                      <span className="text-[9px] text-[#F5F2ED]/45 font-mono">#{i+1}</span>
                                      <span className="text-[#F5F2ED] font-serif">{inf.name}</span>
                                      <span className="text-[8px] text-[#F5F2ED]/40 uppercase tracking-widest font-mono">({inf.type})</span>
                                    </span>
                                    <span className="text-[#F5F2ED]/50 font-mono text-[10px]">Power: {inf.strength.toFixed(2)}x</span>
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}

                          {/* Indirect Trust Pathways list */}
                          {graphIntelligence && graphIntelligence.indirectPaths.length > 0 && (
                            <div className="bg-[#F5F2ED]/5 border border-[#F5F2ED]/10 p-4 rounded-none">
                              <span className="text-[10px] font-sans text-[#F5F2ED]/50 font-semibold uppercase tracking-widest block mb-2">🕸️ Propagated Pathways ({graphIntelligence.indirectPaths.length})</span>
                              <div className="space-y-2 max-h-[140px] overflow-y-auto pr-1">
                                {graphIntelligence.indirectPaths.map((pathObj, i) => {
                                  const isMultiHop = pathObj.path.length > 2;
                                  return (
                                    <div key={i} className="text-[11px] font-sans border-b border-[#F5F2ED]/5 pb-2 last:border-b-0 last:pb-0 flex flex-col gap-1">
                                      <div className="flex items-center justify-between">
                                        <span className={`text-[9px] font-mono px-1 py-0.5 rounded-none font-bold uppercase ${
                                          isMultiHop ? 'text-amber-400 bg-amber-400/5 border border-amber-400/20' : 'text-[#F5F2ED]/50 bg-[#F5F2ED]/5'
                                        }`}>
                                          {isMultiHop ? `${pathObj.path.length - 1} Hops` : 'Direct Link'}
                                        </span>
                                        <span className="text-[#F5F2ED]/40 text-[9px] font-mono">Weight: {pathObj.influence.toFixed(2)}x</span>
                                      </div>
                                      <div className="flex items-center gap-1 font-serif text-[#F5F2ED]/75 flex-wrap">
                                        {pathObj.path.map((item, idx) => (
                                          <React.Fragment key={idx}>
                                            {idx > 0 && <span className="text-[#F5F2ED]/25 text-[10px]">➜</span>}
                                            <span className={idx === pathObj.path.length - 1 ? 'font-bold text-[#F5F2ED]' : ''}>
                                              {item.startsWith('@') ? item : (idx === 0 ? `@${item}` : item)}
                                            </span>
                                          </React.Fragment>
                                        ))}
                                        <span className="text-emerald-400 font-sans font-semibold text-[10.5px] ml-auto">★{pathObj.score}</span>
                                      </div>
                                    </div>
                                  );
                                })}
                              </div>
                            </div>
                          )}

                        </div>
                      ) : (
                        <div className="py-16 text-center text-xs uppercase tracking-widest text-[#F5F2ED]/30 font-sans">
                          Click analyze below to compile dynamic smart trust indicators.
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="py-16 text-center text-xs uppercase tracking-widest text-[#F5F2ED]/30">
                      Select raw entity node to parse indicators.
                    </div>
                  )}
                </div>

                <div className="mt-6 pt-4 border-t border-[#F5F2ED]/10 flex flex-col gap-3 font-sans">
                  <p className="text-[10px] text-[#F5F2ED]/40 uppercase tracking-wider leading-relaxed">
                    AI agent integrates peer staked comments, calculating multi-dimensional polar consensus and audit safety bounds.
                  </p>
                  <button
                    onClick={() => fetchAiExplanation(selectedAtomName)}
                    className="w-full bg-[#F5F2ED] hover:bg-[#F5F2ED]/85 text-[#0A0A0A] border-none py-3 px-4 text-xs font-sans font-bold uppercase tracking-[0.2em] transition-all duration-200 flex items-center justify-center gap-2 cursor-pointer rounded-none"
                  >
                    <Sparkles className="h-4 w-4 shrink-0" />
                    Query Fresh AI Summary
                  </button>
                </div>
              </div>

           {activeTab === 'ledger' && (
            <div className="border border-[#F5F2ED]/10 p-6 bg-[#F5F2ED]/2 rounded-none flex flex-col gap-8">
              
              {/* Header search bar */}
              <div className="flex flex-col sm:flex-row items-start sm:items-baseline justify-between gap-4 pb-4 border-b border-[#F5F2ED]/10">
                <div>
                  <h2 className="text-[#F5F2ED] text-xs uppercase tracking-[0.2em] font-sans flex items-center gap-2">
                    <Database className="h-4 w-4" />
                    Identity Atom Ledgers
                  </h2>
                  <p className="text-xs text-[#F5F2ED]/60 font-sans mt-1">View all decentralized claims, average scores, and creation streams.</p>
                </div>

                <div className="flex items-center gap-3 w-full sm:w-auto font-sans">
                  <div className="relative flex-1 sm:w-60">
                    <Search className="absolute left-3 top-2.5 h-3 w-3 text-[#F5F2ED]/40" />
                    <input 
                      type="text" 
                      placeholder="Search Atom label..."
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      className="w-full bg-[#0A0A0A] border border-[#F5F2ED]/20 rounded-none pl-9 pr-3 py-1.5 text-xs focus:outline-none focus:border-[#F5F2ED]/50 text-[#F5F2ED] placeholder-[#F5F2ED]/25 font-serif"
                    />
                  </div>

                  <select 
                    value={filterType}
                    onChange={(e) => setFilterType(e.target.value)}
                    className="bg-[#0A0A0A] border border-[#F5F2ED]/25 rounded-none px-3 py-1.5 text-xs text-[#F5F2ED]/60 focus:outline-none uppercase tracking-widest text-[10px]"
                  >
                    <option value="all" className="bg-[#0A0A0A]">All Class</option>
                    <option value="project" className="bg-[#0A0A0A]">Projects</option>
                    <option value="wallet" className="bg-[#0A0A0A]">Wallets</option>
                    <option value="user" className="bg-[#0A0A0A]">Users</option>
                  </select>
                </div>
              </div>

              {/* Large list explorer */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {filteredAtoms.length === 0 ? (
                  <div className="col-span-2 text-center py-16 font-sans text-xs tracking-widest uppercase text-[#F5F2ED]/30 border border-dashed border-[#F5F2ED]/10">
                    No matching atoms resolved on the public directory ledger.
                  </div>
                ) : (
                  filteredAtoms.map(atom => {
                    const stats = attestations.filter(a => a.to_entity === atom.name);
                    const avg = stats.length > 0 
                      ? parseFloat((stats.reduce((sum, curr) => sum + curr.trust_score, 0) / stats.length).toFixed(1)) 
                      : 0;

                    const weightedAvg = atom.average !== undefined ? atom.average : avg;
                    const simpleAvg = atom.simpleAverage !== undefined ? atom.simpleAverage : avg;
                    const stakerCount = atom.count !== undefined ? atom.count : stats.length;

                    return (
                      <div 
                        key={atom.id}
                        onClick={() => {
                          setSelectedAtomName(atom.name);
                          // Jump to visual overview
                          setActiveTab('graph');
                        }}
                        className={`p-6 border bg-[#F5F2ED]/2 transition-all duration-200 cursor-pointer flex flex-col justify-between rounded-none group ${
                          selectedAtomName === atom.name 
                            ? 'border-[#F5F2ED] bg-[#F5F2ED]/5 shadow-2xl' 
                            : 'border-[#F5F2ED]/10 hover:border-[#F5F2ED]/30'
                        }`}
                      >
                        <div>
                          <div className="flex items-center justify-between mb-3 font-sans">
                            <span className={`px-2 py-0.5 rounded-none text-[9px] font-bold uppercase tracking-widest ${
                              atom.type === 'project' ? 'bg-[#F5F2ED] text-[#0A0A0A]' :
                              atom.type === 'wallet' ? 'bg-[#C5A880]/15 text-[#C5A880] border border-[#C5A880]/20' :
                              'bg-[#8C92AC]/15 text-[#8C92AC] border border-[#8C92AC]/20'
                            }`}>
                              {atom.type}
                            </span>
                            <span className="text-[10px] text-[#F5F2ED]/35 font-mono">ID: #{atom.id}</span>
                          </div>

                          <h3 className="font-serif italic text-lg text-[#F5F2ED] group-hover:text-[#F5F2ED]/90 transition-colors flex items-center justify-between">
                            {atom.displayName}
                            <ChevronRight className="h-4 w-4 text-[#F5F2ED]/30 opacity-0 group-hover:opacity-100 group-hover:translate-x-1 transition-all" />
                          </h3>
                          <p className="text-xs text-[#F5F2ED]/60 mt-2 leading-relaxed font-serif line-clamp-2 italic">
                            "{atom.description || 'No direct metadata context specified.'}"
                          </p>
                        </div>

                        <div className="mt-6 pt-3 border-t border-[#F5F2ED]/10 flex flex-col gap-2">
                          <div className="flex items-center justify-between text-xs font-sans">
                            <span className="text-[#F5F2ED]/55 uppercase tracking-widest text-[9px]">Weighted Trust:</span>
                            <span className="text-emerald-400 font-bold">
                              ★ {weightedAvg > 0 ? weightedAvg.toFixed(1) : 'None'}
                            </span>
                          </div>
                          
                          <div className="flex items-center justify-between text-[11px] font-sans text-[#F5F2ED]/40">
                            <span>Direct Avg: <span className="text-[#F5F2ED]/70">{simpleAvg > 0 ? simpleAvg.toFixed(1) : '0'}</span></span>
                            <span>{stakerCount} Active Stake{stakerCount === 1 ? '' : 's'}</span>
                          </div>

                          <div className="pt-2 border-t border-[#F5F2ED]/5 flex justify-between items-center text-[9px] text-[#F5F2ED]/35 font-mono">
                            <span>REGISTRY</span>
                            <span>By @{atom.creator}</span>
                          </div>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>

              {/* Bottom raw ledger connection log */}
              <div className="mt-6">
                <h3 className="text-xs uppercase font-sans tracking-[0.2em] text-[#F5F2ED]/40 mb-4 flex items-center gap-1.5">
                  <Layers className="h-4 w-4" />
                  Immutable Claim Record Streams (Triples Ledger)
                </h3>

                <div className="bg-[#0A0A0A] border border-[#F5F2ED]/10 rounded-none overflow-hidden">
                  <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse">
                      <thead>
                        <tr className="border-b border-[#F5F2ED]/15 text-[9px] font-sans uppercase tracking-[0.2em] text-[#F5F2ED]/40 bg-[#F5F2ED]/2 font-bold select-none">
                          <th className="px-6 py-4">Subject User</th>
                          <th className="px-6 py-4">Predicate</th>
                          <th className="px-6 py-4">Object Atom</th>
                          <th className="px-6 py-4 text-center">Score</th>
                          <th className="px-6 py-4">Proof Remark</th>
                          <th className="px-6 py-4 text-right">Time Log</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-[#F5F2ED]/10 text-xs text-[#F5F2ED]/80 font-sans tracking-wide">
                        {attestations.map((att) => (
                          <tr key={att.id} className="hover:bg-[#F5F2ED]/2 transition-colors">
                            <td className="px-6 py-4 font-mono font-bold text-[#C5A880]">@{att.from_user}</td>
                            <td className="px-6 py-4 text-[#F5F2ED]/30 italic font-serif">trusts</td>
                            <td className="px-6 py-4 font-serif italic text-sm">{atoms.find(a => a.name === att.to_entity)?.displayName || att.to_entity}</td>
                            <td className="px-6 py-4 text-center text-emerald-400 font-bold">★ {att.trust_score}</td>
                            <td className="px-6 py-4 text-[#F5F2ED]/60 max-w-xs truncate font-serif italic">"{att.comment}"</td>
                            <td className="px-6 py-4 text-right text-[10px] text-[#F5F2ED]/35 font-mono">{new Date(att.timestamp).toLocaleDateString()}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>

            </div>
          )}

          {activeTab === 'simulator' && (
            <div className="border border-[#F5F2ED]/10 rounded-none overflow-hidden flex flex-col h-[560px] shadow-2xl relative bg-[#0A0A0A]">
              
              {/* Simulator Config Head */}
              <div className="bg-[#F5F2ED]/2 border-b border-[#F5F2ED]/10 px-8 py-5 flex items-center justify-between">
                <div className="flex items-center gap-4">
                  <div className="w-10 h-10 border border-[#F5F2ED]/20 rounded-none flex items-center justify-center text-[#F5F2ED] relative bg-[#0A0A0A]">
                    <Bot className="h-5 w-5 text-[#C5A880]" />
                    <span className="absolute bottom-0 right-0 w-2.5 h-2.5 bg-emerald-400 rounded-full"></span>
                  </div>
                  <div>
                    <h2 className="text-xs uppercase tracking-[0.2em] font-sans text-[#F5F2ED] flex items-center gap-2">
                      TrustGraph Telegram Bot
                      <span className="text-[9px] border border-[#F5F2ED]/20 text-[#F5F2ED]/40 px-2 py-0.5 rounded-none font-sans font-bold uppercase tracking-widest">EMULATOR</span>
                    </h2>
                    <p className="text-xs text-[#F5F2ED]/50 font-sans tracking-wide">Synthesized local container thread representing real bot hooks.</p>
                  </div>
                </div>

                <div className="flex items-center gap-3 text-xs font-sans">
                  <span className="text-[#F5F2ED]/40 uppercase tracking-widest text-[10px]">Running as:</span>
                  <div className="relative">
                    <span className="absolute left-2.5 top-1 px-0.5 text-[#F5F2ED]/30 font-bold font-serif">@</span>
                    <input 
                      type="text" 
                      value={simulatorUser}
                      onChange={(e) => setSimulatorUser(e.target.value)}
                      className="bg-[#0A0A0A] border border-[#F5F2ED]/25 rounded-none px-3.5 pl-6 py-1 text-[#F5F2ED] focus:outline-none focus:border-[#F5F2ED]/50 text-xs font-serif italic w-44"
                    />
                  </div>
                </div>
              </div>

              {/* Chat Canvas Section */}
              <div className="flex-1 overflow-y-auto p-8 space-y-6 bg-[#0A0A0A]/30">
                {chatLog.map((msg, i) => (
                  <div 
                    key={i} 
                    className={`flex gap-4 max-w-xl ${
                      msg.sender === 'user' ? 'ml-auto flex-row-reverse' : ''
                    }`}
                  >
                    <div className={`w-8 h-8 rounded-none shrink-0 flex items-center justify-center font-bold text-xs font-sans uppercase ${
                      msg.sender === 'user' 
                        ? 'border border-[#C5A880]/20 bg-[#C5A880]/10 text-[#C5A880]' 
                        : 'bg-[#F5F2ED] text-[#0A0A0A]'
                    }`}>
                      {msg.sender === 'user' ? 'U' : 'B'}
                    </div>

                    <div className={`p-5 rounded-none max-w-lg leading-relaxed text-xs shadow-xl ${
                      msg.sender === 'user'
                        ? 'bg-[#F5F2ED]/5 border border-[#F5F2ED]/20 text-[#F5F2ED]'
                        : 'bg-[#F5F2ED] border-none text-[#0A0A0A] selection:bg-[#0A0A0A] selection:text-[#F5F2ED]'
                    }`}>
                      <div 
                        className="whitespace-pre-line font-sans tracking-wide leading-relaxed"
                        dangerouslySetInnerHTML={{ __html: msg.text }}
                      />
                      <span className={`block text-[8px] font-mono mt-3 text-right ${
                        msg.sender === 'user' ? 'text-[#F5F2ED]/30' : 'text-[#0A0A0A]/40'
                      }`}>
                        {msg.timestamp}
                      </span>
                    </div>
                  </div>
                ))}

                {/* Typing state feedback */}
                {isBotTyping && (
                  <div className="flex gap-4 max-w-xl">
                    <div className="w-8 h-8 rounded-none shrink-0 flex items-center justify-center bg-[#F5F2ED] text-[#0A0A0A] font-bold text-xs font-sans">
                      B
                    </div>
                    <div className="bg-[#F5F2ED] text-[#000000] p-4 text-xs flex items-center gap-1.5 rounded-none">
                      <span className="h-1.5 w-1.5 bg-[#0a0a0a]/50 rounded-full animate-bounce"></span>
                      <span className="h-1.5 w-1.5 bg-[#0a0a0a]/50 rounded-full animate-bounce delay-100"></span>
                      <span className="h-1.5 w-1.5 bg-[#0a0a0a]/50 rounded-full animate-bounce delay-200"></span>
                    </div>
                  </div>
                )}

                <div ref={chatEndRef} />
              </div>

              {/* Quick Command Suggestion Board */}
              <div className="px-8 py-3 bg-[#F5F2ED]/2 border-t border-[#F5F2ED]/10 flex flex-wrap gap-2.5 items-center font-sans">
                <span className="text-[10px] text-[#F5F2ED]/40 uppercase tracking-widest mr-2">Core Command Templates:</span>
                <button 
                  onClick={() => triggerDemoCommand('/start')}
                  className="bg-[#0A0A0A] hover:bg-[#F5F2ED]/5 border border-[#F5F2ED]/20 text-[#F5F2ED]/70 hover:text-[#F5F2ED] text-[9px] px-3 py-1 uppercase tracking-widest transition-colors cursor-pointer"
                >
                  /start
                </button>
                <button 
                  onClick={() => triggerDemoCommand('/attest VitalikWallet 5 "Active creator of smart contracts"')}
                  className="bg-[#0A0A0A] hover:bg-[#F5F2ED]/5 border border-[#F5F2ED]/20 text-[#F5F2ED]/70 hover:text-[#F5F2ED] text-[9px] px-3 py-1 uppercase tracking-widest transition-colors cursor-pointer"
                >
                  /attest VitalikWallet
                </button>
                <button 
                  onClick={() => triggerDemoCommand('/trust Ethereum')}
                  className="bg-[#0A0A0A] hover:bg-[#F5F2ED]/5 border border-[#F5F2ED]/20 text-[#F5F2ED]/70 hover:text-[#F5F2ED] text-[9px] px-3 py-1 uppercase tracking-widest transition-colors cursor-pointer"
                >
                  /trust Ethereum
                </button>
                <button 
                  onClick={() => triggerDemoCommand('/graph Ethereum')}
                  className="bg-[#0A0A0A] hover:bg-[#F5F2ED]/5 border border-[#F5F2ED]/20 text-[#F5F2ED]/70 hover:text-[#F5F2ED] text-[9px] px-3 py-1 uppercase tracking-widest transition-colors cursor-pointer"
                >
                  /graph Ethereum
                </button>
                <button 
                  onClick={() => triggerDemoCommand('/entities')}
                  className="bg-[#0A0A0A] hover:bg-[#F5F2ED]/5 border border-[#F5F2ED]/20 text-[#F5F2ED]/70 hover:text-[#F5F2ED] text-[9px] px-3 py-1 uppercase tracking-widest transition-colors cursor-pointer"
                >
                  /entities
                </button>
              </div>

              {/* Chat Console input */}
              <form onSubmit={handleSendChat} className="p-4 bg-[#0A0A0A] border-t border-[#F5F2ED]/10 flex gap-3">
                <input 
                  type="text" 
                  value={chatInput}
                  onChange={(e) => setChatInput(e.target.value)}
                  placeholder="Type telegram bot command e.g., /trust solana или /start..."
                  className="flex-1 bg-[#0A0A0A] border border-[#F5F2ED]/20 rounded-none px-4 py-3 text-xs text-[#F5F2ED] placeholder-[#F5F2ED]/25 focus:outline-none focus:border-[#F5F2ED]/50 font-serif italic"
                />
                <button 
                  type="submit"
                  className="bg-[#F5F2ED] hover:bg-[#F5F2ED]/85 text-[#0A0A0A] rounded-none px-6 py-3 flex items-center justify-center transition-colors cursor-pointer"
                >
                  <Send className="h-4 w-4" />
                </button>
              </form>

            </div>
          )}

          {/* Setup Guide Accordion */}
          <div className="border border-[#F5F2ED]/10 p-6 bg-[#F5F2ED]/2 rounded-none">
            <h2 className="text-xs uppercase tracking-[0.2em] font-sans text-[#F5F2ED]/40 mb-3 flex items-center gap-1.5">
              <Terminal className="h-3.5 w-3.5 text-[#F5F2ED]" />
              Production Setup Guide
            </h2>

            <div className="border border-[#F5F2ED]/10 p-5 rounded-none text-xs space-y-4 font-sans leading-relaxed text-[#F5F2ED]/80">
              <p className="text-[#F5F2ED]/50 leading-relaxed font-serif italic">
                To connect this application to a real live running Telegram Bot, follow these simple production parameters:
              </p>

              <div className="space-y-1.5 p-4 border border-[#F5F2ED]/10 bg-[#0A0A0A]/40 rounded-none">
                <div className="flex justify-between text-[11px] uppercase tracking-wider text-[#C5A880] font-bold">
                  <span>1. Generate Bot Token</span>
                  <span className="text-[#F5F2ED]/30 font-normal">@BotFather</span>
                </div>
                <p className="text-[#F5F2ED]/60 text-[11px] leading-relaxed">
                  Open Telegram, search for **@BotFather**, send `/newbot`, choose a name, and copy the provided `API Token`.
                </p>
              </div>

              <div className="space-y-1.5 p-4 border border-[#F5F2ED]/10 bg-[#0A0A0A]/40 rounded-none">
                <div className="flex justify-between text-[11px] uppercase tracking-wider text-[#C5A880] font-bold">
                  <span>2. Inject Environment Variable</span>
                  <span className="text-[#F5F2ED]/30 font-normal">Secrets / .env</span>
                </div>
                <p className="text-[#F5F2ED]/60 text-[11px] leading-relaxed">
                  Paste the token inside your local `.env` or write a new Secret key parameter on the settings drawer:
                </p>
                <pre className="text-[10px] bg-[#0A0A0A] p-3 text-[#C5A880] border border-[#F5F2ED]/10 font-mono">
                  {"TELEGRAM_BOT_TOKEN=\"583921...MY-TELEGRAM-TOKEN-HERE\""}
                </pre>
              </div>

              <div className="space-y-1.5 p-4 border border-[#F5F2ED]/10 bg-[#0A0A0A]/40 rounded-none">
                <div className="flex justify-between text-[11px] uppercase tracking-wider text-[#C5A880] font-bold">
                  <span>3. Boot Live polling</span>
                  <span className="text-[#F5F2ED]/30 font-normal">npm start</span>
                </div>
                <p className="text-[#F5F2ED]/60 text-[11px] leading-relaxed font-serif italic">
                  The Express server automatically detects the token, spins up real-time update polling threads, and handles active user chats instantly!
                </p>
              </div>
            </div>
          </div>

        </div>

      </main>

      {/* Footer credits and metadata metrics */}
      <footer className="border-t border-[#F5F2ED]/10 py-8 px-8 mt-12 bg-[#0A0A0A]/60 backdrop-blur text-center text-[10px] text-[#F5F2ED]/45 font-sans flex flex-col sm:flex-row items-center justify-between gap-4 max-w-[1700px] mx-auto w-full uppercase tracking-widest">
        <p>© 2026 TrustGraph Protocol. Powered by Intuition Architectural Concepts & Gemini 2.5 Flash Model.</p>
        <div className="flex items-center gap-4">
          <span>Active Port: 3000</span>
          <span>●</span>
          <span>Sandbox Mode: Ready</span>
        </div>
      </footer>

    </div>
  );
}
