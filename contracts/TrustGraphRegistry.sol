// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/**
 * @title TrustGraphRegistry
 * @notice On-chain trust and reputation attestation registry for Robinhood Chain Testnet (Chain ID 46630).
 * @dev Trust Model & Limitations:
 * - Subjects are represented by deterministic `bytes32` identifiers (e.g. keccak256 of normalized entity ID)
 *   so no personal data, phone numbers, or private messages are stored on-chain.
 * - Supporting explanations are anchored via `bytes32 evidenceHash` (keccak256 of canonical off-chain payload).
 * - Duplicate/Spam Policy: Each `(attester, subjectId)` pair may hold at most ONE active attestation at any time.
 *   Submitting a new attestation for the same `subjectId` automatically supersedes (revokes) the caller's prior
 *   active attestation and updates aggregate subject counters atomically.
 * - Sybil Notice: This registry records cryptographic wallet attestations; it does not enforce proof-of-personhood
 *   or Sybil resistance on-chain. Consumers should evaluate attester history alongside raw counts.
 * - Security Status: Unaudited testnet contract intended for Robinhood Chain Testnet experimentation.
 *   A formal independent security audit is required before mainnet deployment.
 */
contract TrustGraphRegistry {
    // -------------------------------------------------------------------------
    // Custom Errors
    // -------------------------------------------------------------------------
    error InvalidSubject();
    error InvalidScore(uint8 provided);
    error AttestationNotFound(uint256 attestationId);
    error UnauthorizedAttester(address caller, address attester);
    error AlreadyRevoked(uint256 attestationId);

    // -------------------------------------------------------------------------
    // Data Structures
    // -------------------------------------------------------------------------
    struct AttestationRecord {
        bytes32 subjectId;      // Deterministic identifier of the attested entity
        bytes32 evidenceHash;   // Keccak-256 hash of supporting off-chain evidence (or bytes32(0))
        address attester;       // Wallet that submitted the attestation
        uint64 createdAt;       // Block timestamp when created
        uint8 score;            // Trust score in inclusive range [1, 5]
        bool revoked;           // Whether revoked explicitly or superseded by newer attestation
        uint64 revokedAt;       // Block timestamp when revoked (0 if active)
    }

    struct SubjectSummary {
        uint64 activeCount;
        uint64 revokedCount;
        uint128 activeScoreSum;
    }

    // -------------------------------------------------------------------------
    // Constants & Storage
    // -------------------------------------------------------------------------
    uint8 public constant MIN_SCORE = 1;
    uint8 public constant MAX_SCORE = 5;

    uint256 private _nextAttestationId = 1;

    /// @dev attestationId (1-indexed) => AttestationRecord
    mapping(uint256 => AttestationRecord) private _attestations;

    /// @dev subjectId => aggregate reputation counters
    mapping(bytes32 => SubjectSummary) private _subjectSummaries;

    /// @dev subjectId => list of all attestation IDs ever created for subject
    mapping(bytes32 => uint256[]) private _subjectAttestationIds;

    /// @dev attester => list of all attestation IDs ever created by wallet
    mapping(address => uint256[]) private _attesterAttestationIds;

    /// @dev attester => subjectId => currently active attestationId (0 if none)
    mapping(address => mapping(bytes32 => uint256)) private _activeAttestationByPair;

    // -------------------------------------------------------------------------
    // Events
    // -------------------------------------------------------------------------
    event AttestationCreated(
        uint256 indexed attestationId,
        bytes32 indexed subjectId,
        address indexed attester,
        uint8 score,
        bytes32 evidenceHash,
        uint64 createdAt
    );

    event AttestationRevoked(
        uint256 indexed attestationId,
        bytes32 indexed subjectId,
        address indexed attester,
        uint64 revokedAt,
        bool superseded
    );

    // -------------------------------------------------------------------------
    // External Write Functions
    // -------------------------------------------------------------------------

    /**
     * @notice Submit a new trust attestation for `subjectId` with score `1..5` and optional `evidenceHash`.
     * @dev If `msg.sender` already has an active attestation for `subjectId`, that prior attestation is
     *      marked revoked (`superseded = true`) and replaced atomically so one wallet cannot inflate `activeCount`.
     * @param subjectId Non-zero deterministic bytes32 identifier for the target entity.
     * @param score Integer trust rating between 1 (lowest trust) and 5 (highest trust).
     * @param evidenceHash Keccak-256 hash of canonical off-chain explanation metadata, or bytes32(0).
     * @return attestationId Newly assigned 1-indexed attestation ID.
     */
    function attest(
        bytes32 subjectId,
        uint8 score,
        bytes32 evidenceHash
    ) external returns (uint256 attestationId) {
        if (subjectId == bytes32(0)) revert InvalidSubject();
        if (score < MIN_SCORE || score > MAX_SCORE) revert InvalidScore(score);

        uint64 nowTs = uint64(block.timestamp);
        SubjectSummary storage summary = _subjectSummaries[subjectId];

        // Supersede previous active attestation for (msg.sender, subjectId) if present
        uint256 priorId = _activeAttestationByPair[msg.sender][subjectId];
        if (priorId != 0) {
            AttestationRecord storage prior = _attestations[priorId];
            if (!prior.revoked) {
                prior.revoked = true;
                prior.revokedAt = nowTs;
                summary.activeCount -= 1;
                summary.revokedCount += 1;
                summary.activeScoreSum -= prior.score;

                emit AttestationRevoked(priorId, subjectId, msg.sender, nowTs, true);
            }
        }

        attestationId = _nextAttestationId++;

        _attestations[attestationId] = AttestationRecord({
            subjectId: subjectId,
            evidenceHash: evidenceHash,
            attester: msg.sender,
            createdAt: nowTs,
            score: score,
            revoked: false,
            revokedAt: 0
        });

        _activeAttestationByPair[msg.sender][subjectId] = attestationId;
        _subjectAttestationIds[subjectId].push(attestationId);
        _attesterAttestationIds[msg.sender].push(attestationId);

        summary.activeCount += 1;
        summary.activeScoreSum += score;

        emit AttestationCreated(
            attestationId,
            subjectId,
            msg.sender,
            score,
            evidenceHash,
            nowTs
        );
    }

    /**
     * @notice Revoke a previously submitted active attestation. Only callable by the original attester.
     * @param attestationId The 1-indexed ID of the attestation to revoke.
     */
    function revoke(uint256 attestationId) external {
        AttestationRecord storage record = _attestations[attestationId];
        if (record.attester == address(0)) revert AttestationNotFound(attestationId);
        if (record.attester != msg.sender) revert UnauthorizedAttester(msg.sender, record.attester);
        if (record.revoked) revert AlreadyRevoked(attestationId);

        uint64 nowTs = uint64(block.timestamp);
        record.revoked = true;
        record.revokedAt = nowTs;

        if (_activeAttestationByPair[msg.sender][record.subjectId] == attestationId) {
            _activeAttestationByPair[msg.sender][record.subjectId] = 0;
        }

        SubjectSummary storage summary = _subjectSummaries[record.subjectId];
        summary.activeCount -= 1;
        summary.revokedCount += 1;
        summary.activeScoreSum -= record.score;

        emit AttestationRevoked(attestationId, record.subjectId, msg.sender, nowTs, false);
    }

    // -------------------------------------------------------------------------
    // External View Functions
    // -------------------------------------------------------------------------

    /**
     * @notice Total number of attestations ever created in this registry (including revoked).
     */
    function totalAttestations() external view returns (uint256) {
        return _nextAttestationId - 1;
    }

    /**
     * @notice Retrieve full attestation record by ID. Reverts if ID does not exist.
     */
    function getAttestation(uint256 attestationId) external view returns (AttestationRecord memory) {
        AttestationRecord memory record = _attestations[attestationId];
        if (record.attester == address(0)) revert AttestationNotFound(attestationId);
        return record;
    }

    /**
     * @notice Reliable check for whether an attestation has been revoked. Reverts if ID does not exist.
     */
    function isRevoked(uint256 attestationId) external view returns (bool) {
        AttestationRecord storage record = _attestations[attestationId];
        if (record.attester == address(0)) revert AttestationNotFound(attestationId);
        return record.revoked;
    }

    /**
     * @notice Returns the currently active attestation ID for `(attester, subjectId)`, or 0 if none.
     */
    function getActiveAttestationId(address attester, bytes32 subjectId) external view returns (uint256) {
        return _activeAttestationByPair[attester][subjectId];
    }

    /**
     * @notice Returns explicit aggregate reputation metrics for `subjectId`.
     * @return activeCount Number of currently unrevoked attestations.
     * @return revokedCount Number of revoked or superseded attestations.
     * @return activeScoreSum Sum of active scores.
     * @return averageScoreBps Mean active score scaled by 100 (e.g. 450 = 4.50 / 5.00), or 0 if activeCount == 0.
     */
    function getSubjectSummary(bytes32 subjectId)
        external
        view
        returns (
            uint64 activeCount,
            uint64 revokedCount,
            uint128 activeScoreSum,
            uint256 averageScoreBps
        )
    {
        SubjectSummary memory summary = _subjectSummaries[subjectId];
        activeCount = summary.activeCount;
        revokedCount = summary.revokedCount;
        activeScoreSum = summary.activeScoreSum;
        averageScoreBps = activeCount > 0
            ? (uint256(activeScoreSum) * 100) / uint256(activeCount)
            : 0;
    }

    /**
     * @notice Paginated lookup of attestation IDs for `subjectId`.
     */
    function getSubjectAttestationIds(
        bytes32 subjectId,
        uint256 offset,
        uint256 limit
    ) external view returns (uint256[] memory ids, uint256 total) {
        uint256[] storage allIds = _subjectAttestationIds[subjectId];
        total = allIds.length;
        if (offset >= total || limit == 0) {
            return (new uint256[](0), total);
        }
        uint256 end = offset + limit;
        if (end > total) {
            end = total;
        }
        uint256 resultLen = end - offset;
        ids = new uint256[](resultLen);
        for (uint256 i = 0; i < resultLen; i++) {
            ids[i] = allIds[offset + i];
        }
    }

    /**
     * @notice Paginated lookup of attestation IDs created by `attester`.
     */
    function getAttesterAttestationIds(
        address attester,
        uint256 offset,
        uint256 limit
    ) external view returns (uint256[] memory ids, uint256 total) {
        uint256[] storage allIds = _attesterAttestationIds[attester];
        total = allIds.length;
        if (offset >= total || limit == 0) {
            return (new uint256[](0), total);
        }
        uint256 end = offset + limit;
        if (end > total) {
            end = total;
        }
        uint256 resultLen = end - offset;
        ids = new uint256[](resultLen);
        for (uint256 i = 0; i < resultLen; i++) {
            ids[i] = allIds[offset + i];
        }
    }
}
