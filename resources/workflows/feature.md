# Feature Workflow

## Route

Classify process scope first: spike, bounded, or architectural.

### Bounded
DISCOVERY → CLARIFICATION → SHORT DESIGN → IMPLEMENTATION → VERIFICATION → KNOWLEDGE UPDATE → DONE

### Architectural
DISCOVERY → CLARIFICATION → SPEC → PLAN → IMPLEMENTATION → VERIFICATION → KNOWLEDGE UPDATE → DONE

## Gates
- Discover technical facts before asking the user.
- Do not implement until expected behavior is explicit enough to verify.
- No DONE transition without fresh verification evidence.
