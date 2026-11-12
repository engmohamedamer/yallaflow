# PF-0140 — Console first-run flow: confusing baseline review and run-setup steps; Start buttons do nothing for a service already running outside YallaFlow

## Raw Request

مع  بدايه ادراج مشورع موجود قبل كدة خاص ووقف عند الخطوه دى اللى  فىىالصور
هو فتح حاجتين  راجع المسوده   مع جهز تشغيل اتطبيق هل دة منطقى ؟
لما ضغطت على راجع المسوده عرض الصوره اللى تحت هل دى كافى او هو كدة تمام ؟
انا ضغطت موافق واعتمد المسوده بعدها  اختفت الخطوتين اللى كانوا مفتوحين 
بعدها رحت للصفحه نظه عامه براجع التحديث  ضغطت كمل مع الوكيل

حاليا ظاهر راجع وشغل التطبيق  وتحتها  راجع ووثق  كدة مازال هيحصلل لبس هنا 
ضغطت وافق وكمل المشروع ظهرت الصوره اللىتحت كدة هو عمل ايه ؟بعدها ضغط على شغل او شغل المشروع مفيش حاجه بتحصل ولما ضغطت على افتح سرعه اشتغلوا عادى ؟؟

## Routing

**Status:** pending

The coding agent must classify this request using the YallaFlow routing contract.

## Source Added

**Source ID:** SRC-0099
**Type:** file
**Name:** screenshot-1794488802061-1.png

Raw source preserved in: `.yallaflow/sources/SRC-0099/screenshot-1794488802061-1.png`. Read it directly; it is not duplicated here.

## Source Added

**Source ID:** SRC-0100
**Type:** file
**Name:** screenshot-1794488847814-2.png

Raw source preserved in: `.yallaflow/sources/SRC-0100/screenshot-1794488847814-2.png`. Read it directly; it is not duplicated here.

## Source Added

**Source ID:** SRC-0101
**Type:** file
**Name:** screenshot-1794488965748-3.png

Raw source preserved in: `.yallaflow/sources/SRC-0101/screenshot-1794488965748-3.png`. Read it directly; it is not duplicated here.

## Source Added

**Source ID:** SRC-0102
**Type:** file
**Name:** screenshot-1794489009202-4.png

Raw source preserved in: `.yallaflow/sources/SRC-0102/screenshot-1794489009202-4.png`. Read it directly; it is not duplicated here.

## Source Added

**Source ID:** SRC-0103
**Type:** file
**Name:** screenshot-1794489070834-5.png

Raw source preserved in: `.yallaflow/sources/SRC-0103/screenshot-1794489070834-5.png`. Read it directly; it is not duplicated here.

## Source Added

**Source ID:** SRC-0104
**Type:** file
**Name:** screenshot-1794489121500-6.png

Raw source preserved in: `.yallaflow/sources/SRC-0104/screenshot-1794489121500-6.png`. Read it directly; it is not duplicated here.

## Source Added

**Source ID:** SRC-0105
**Type:** file
**Name:** screenshot-1794489136721-7.png

Raw source preserved in: `.yallaflow/sources/SRC-0105/screenshot-1794489136721-7.png`. Read it directly; it is not duplicated here.

## Source Added

**Source ID:** SRC-0106
**Type:** file
**Name:** screenshot-1794489185236-8.png

Raw source preserved in: `.yallaflow/sources/SRC-0106/screenshot-1794489185236-8.png`. Read it directly; it is not duplicated here.

## Source Added

**Source ID:** SRC-0107
**Type:** file
**Name:** screenshot-1794489219631-9.png

Raw source preserved in: `.yallaflow/sources/SRC-0107/screenshot-1794489219631-9.png`. Read it directly; it is not duplicated here.

## Source Added

**Source ID:** SRC-0108
**Type:** file
**Name:** screenshot-1794489239624-10.png

Raw source preserved in: `.yallaflow/sources/SRC-0108/screenshot-1794489239624-10.png`. Read it directly; it is not duplicated here.

## Source Added

**Source ID:** SRC-0109
**Type:** file
**Name:** screenshot-1794489323693-11.png

Raw source preserved in: `.yallaflow/sources/SRC-0109/screenshot-1794489323693-11.png`. Read it directly; it is not duplicated here.

## Source Added

**Source ID:** SRC-0110
**Type:** file
**Name:** screenshot-1794489376981-12.png

Raw source preserved in: `.yallaflow/sources/SRC-0110/screenshot-1794489376981-12.png`. Read it directly; it is not duplicated here.

## Routing Decision

**Status:** routed
**Work type:** bug
**Scope:** bounded
**Confidence:** high
**Reason:** Owner walked an existing project through console onboarding (12 screenshots) and hit UX defects confined to the console UI: two competing next steps, a thin draft-review view, duplicated approve controls on the Run tab, and Start buttons with no effect or feedback when the service already runs outside YallaFlow. No data model, security, or contract change: bounded console presentation/behavior fix.
**Timestamp:** 2026-11-12T13:18:47.795Z
**Workflow:** bug
**Required capabilities:** discover, systematic-debugging, implement, verify
**Behavior contract:** registry v9
**Skills:** context-discovery, systematic-debugging, implementation, verification
**Read-only:** no

## Intake

## Known Facts

## Open Questions

## Reproduction

## Evidence

## Hypothesis

## Root Cause

## Discovery

## Specification / Expected Behavior

## Implementation Plan

## Verification Evidence

## Decisions / Rulings

## Knowledge Updates

## Result
