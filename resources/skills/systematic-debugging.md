# Systematic Debugging

## Purpose

Establish an evidence-backed root cause before accepting a production fix.

## Investigation Sequence

1. **Observe** the reported symptom precisely.
2. **Reproduce** it under controlled conditions, or document why reproduction is unavailable.
3. **Gather evidence** from logs, tests, state, configuration, and relevant code paths.
4. **Trace** the behavior through the system to the point where actual and expected behavior diverge.
5. **Compare** with a working path, prior behavior, or established project pattern.
6. **Form a hypothesis** that explains the evidence and predicts additional observations.
7. **Confirm root cause** by testing that prediction and ruling out competing explanations.
8. **Only then fix** when the workflow stage and work policy authorize modification.

## Evidence Vocabulary

- **Symptom:** the externally visible failure or unexpected behavior.
- **Evidence:** an observed fact that can be reproduced or inspected.
- **Hypothesis:** a testable explanation that has not yet been confirmed.
- **Confirmed root cause:** the causal explanation supported by evidence and a successful prediction or isolation step.
- **Fix:** a change addressing the confirmed cause rather than merely masking the symptom.

## Guard

No production fix should be proposed as the accepted solution before root-cause investigation. This skill remains read-only until the workflow reaches its explicit implementation gate.

## Result

Produce a documented root cause, supporting evidence, and the smallest justified fix direction.
