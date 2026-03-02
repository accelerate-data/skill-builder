# Data Extraction

## Focus

Probe each extraction pattern (full, incremental, CDC) for silent data loss. Look for timestamp fields that miss system-initiated changes, soft delete mechanisms requiring special API calls, multi-tenant filtering gaps, and parent-child relationships where parent changes do not propagate to child timestamps. Include scale-specific failures like governor limits and rate throttling.

## Delta Principle

The key failure modes include: ORG_ID filtering (missed in ~4/10 Claude responses), SystemModstamp vs. LastModifiedDate (Claude inconsistently recommends the correct one), queryAll() for soft deletes, and WHO column CDC limitations. These are platform-specific traps within each extraction pattern that cause silent data loss — the pipeline runs successfully but produces incomplete or stale data.

## Coverage Targets

Research should surface: platform-specific extraction traps causing silent data loss, CDC mechanism selection, soft delete handling, and completeness guarantees. Focus on decisions that change skill content.

## Questions to Research

1. Which timestamp field should be used for incremental change detection, and which commonly used alternatives miss system-initiated changes?
2. How are soft deletes surfaced by this platform's API — does the standard query endpoint return deleted records, or is a special query mode or endpoint required?
3. Are there multi-tenant filtering requirements (e.g., ORG_ID) that must be applied to every extraction query, and what happens when they are omitted?
4. For parent-child object relationships, do changes to the parent propagate to the child's change timestamp, or must child objects be extracted independently?
5. Which platform governor limits or rate throttling behaviors only appear at production data volumes, and how should extraction logic account for them?
6. Which CDC limitations exist at the field or object level — are there specific field types or system fields that are not captured by the standard change detection mechanism?
7. Are there completeness guarantees the platform does or does not provide — can the extraction mechanism confirm that no records were missed?
