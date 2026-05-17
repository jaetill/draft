# ADR-NNNN: {short title}

- **Status:** Proposed | Accepted | Deprecated | Superseded by ADR-NNNN
- **Date:** YYYY-MM-DD
- **Deciders:** {names}
- **Tags:** {comma-separated, e.g. testing, ci-cd, aws}

> **Format:** This ADR follows [MADR 4.x](https://adr.github.io/madr/) with three documented extensions: (1) **Neutral consequences** as a third bucket alongside Positive/Negative; (2) **Implementation notes** as a separate section before Links; (3) **Bundled sub-decisions** when multiple related decisions are tightly coupled (each sub-decision gets its own Considered Options and Pros and Cons sections).

## Context and Problem Statement

What's the problem? What needs deciding? Anyone reading 2 years from now should understand *why this decision needed to be made* without external context.

State the problem in 2–3 sentences, ideally as a question you're answering.

## Decision Drivers

The forces shaping the decision — constraints, requirements, considerations that any acceptable answer must respect.

- {driver 1}
- {driver 2}
- {driver 3}

## Considered Options

For a single-decision ADR:
- Option A: {short title}
- Option B: {short title}
- Option C: {short title}

For a bundled-sub-decision ADR, list the sub-decisions instead:
- Sub-decision 1: {what's being chosen}
- Sub-decision 2: {what's being chosen}
- Sub-decision 3: {what's being chosen}

## Decision Outcome

**Single-decision form:**

Chosen option: **Option {X}**, because {one or two sentences naming the decisive factor}.

**Bundled form:**

We chose the bundle:

- Sub-decision 1 → {chosen option}
- Sub-decision 2 → {chosen option}
- Sub-decision 3 → {chosen option}

The bundle is internally consistent because {the coupling that makes the choices co-dependent}.

## Consequences

### Positive

- What gets easier or better.

### Negative

- What gets harder; what we're explicitly accepting as cost.

### Neutral

- What changes but isn't strictly better or worse. (MADR extension — keep this section even when empty as a forcing function to consider it.)

## Pros and Cons of the Options

**Single-decision form:**

### Option A: {name}

- ✅ Pro: {argument}
- ✅ Pro: {argument}
- ❌ Con: {argument}

### Option B: {name}

- ✅ Pro: {argument}
- ❌ Con: {argument}

### Option C: {name}

- ✅ Pro: {argument}
- ❌ Con: {argument}

**Bundled form:** Repeat per sub-decision.

### Sub-decision 1: {name}

| Option | Pros | Cons |
|---|---|---|
| **A** | ... | ... |
| **B** (chosen) | ... | ... |
| **C** | ... | ... |

(Tables are an acceptable alternative to bulleted pros/cons when comparing >2 options on the same axes — they read better at scale.)

### Sub-decision 2: {name}

[Same structure.]

## Implementation notes

(MADR extension — pointers to operational artifacts that make this decision real.)

- Standards doc: [`docs/standards/NN-name.md`](../standards/NN-name.md)
- Affected workflows: ...
- Affected templates: ...

## Links

- [Authoritative source 1](url) — what it adds.
- [Authoritative source 2](url) — what it adds.
- ADR-NNNN — related decision.
