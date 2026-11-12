# A visual tour of YallaFlow 1.5.2

[العربية](tour.ar.md) · [README](../README.md) · [Console reference](console.md) · [Runtime reference](runtime.md)

This tour follows one project from an empty folder to a running app. A simple request goes from Create work to Done, and the app is set up so you start and stop it from one page. Every screen is the real console. The screens were captured from a demo project, and [the script that made them](../research/docs-tour/capture.mjs) can capture them again.

The console speaks **Arabic and English** and has **light and dark** themes. Each step shows both: English in light, Arabic in dark.

```mermaid
flowchart LR
    A(["New project"]) --> B["Create work<br/>in your words"]
    B --> C["Your agent works<br/>Understand → Decide → Change"]
    C --> D["Verify<br/>with evidence"]
    D --> E(["Done<br/>and remembered"])
    A --> S["Run<br/>agent proposes the services"]
    S --> T["You approve the commands"]
    T --> R(["▶ Start project"])
```

---

## Part 1 · From an empty folder to a project

### 1. Describe the idea

**All projects → New project** asks for a name, what you want to build, and where to create it. Requirements and attachments are optional.

| English | العربية |
| --- | --- |
| ![New project: the idea step](images/tour/00-new-project-en.webp) | ![مشروع جديد: خطوة الفكرة](images/tour/00-new-project-ar.webp) |

### 2. Review exactly what will happen

Next you choose the stack and the environment. Before anything is created, the console shows **what will be created and what will not happen**: no overwrite, no remote, no commit or push, no service started and no agent started. **Create the project** carries out exactly this plan. If the plan changed, creation is refused.

| English | العربية |
| --- | --- |
| ![Review & create](images/tour/00b-new-project-review-en.webp) | ![راجع وأنشئ](images/tour/00b-new-project-review-ar.webp) |

### 3. The project page

The new project opens on **Project → Overview**. On top is what is left before new work: here, one step, **choose this project's agent** (Codex, or Claude Code as experimental). **Start here** names the next action, and below it a checklist built from real records shows what exists and what is next: goal, requirements, stack, development environment, Git and agent. Your description is already kept on the first work item.

| English | العربية |
| --- | --- |
| ![Project Overview](images/tour/01-overview-en.webp) | ![نظرة على المشروع](images/tour/01-overview-ar.webp) |

---

## Part 2 · A simple request, from Create work to Done

### 4. Create work in your own words

Press **＋ Create work** and write what you need, as you would tell a colleague. You can attach a screenshot or a BRD. YallaFlow records the request, and no agent starts on its own.

| English | العربية |
| --- | --- |
| ![Create work](images/tour/02-create-work-en.webp) | ![شغل جديد](images/tour/02-create-work-ar.webp) |

### 5. Watch it move

Your agent (Claude Code or Codex) classifies the request: here, a *bounded change*. It then works through the stations. The Workspace's **List** shows every item with its stations, its next step and a completion percentage. YallaFlow computes that percentage from evidence; it is not the agent's opinion.

| English | العربية |
| --- | --- |
| ![Work board](images/tour/03-work-board-en.webp) | ![لوحة الشغل](images/tour/03-work-board-ar.webp) |

### 6. One item, every station

Open an item to see each station: what was understood, what was decided, what changed, and what each step handed to the next. **Next step** says what is pending and who owns it. Here the agent has to verify. **Why it can't advance yet** names the exact blocker.

| English | العربية |
| --- | --- |
| ![Work item in progress](images/tour/04-item-in-progress-en.webp) | ![شغلانة شغّالة](images/tour/04-item-in-progress-ar.webp) |

### 7. Done means proven

The agent ran a real check (`V-001`), and the knowledge review happened. Only then did the item become **Done: delivered, proven, remembered**. Passing tests alone never closes an item, and neither does the agent saying "done".

| English | العربية |
| --- | --- |
| ![Work item done](images/tour/05-item-done-en.webp) | ![شغلانة خلصت](images/tour/05-item-done-ar.webp) |

### 8. The whole flow at a glance

The Workspace's **Flow** puts every item on its station, from New to Done, with what is waiting for you, what is failing and what is working.

| English | العربية |
| --- | --- |
| ![Flow](images/tour/06-flow-en.webp) | ![التدفق](images/tour/06-flow-ar.webp) |

---

## Part 3 · Get the app running, then just press Start

### 9. Let the agent work out how it runs

**Project → Run** is one guided flow: **Propose the services → Your approval → Start**. Asking the agent comes first. It analyzes the project itself and reads the real configuration: Docker Compose, vhosts, and the folders above the project. It then proposes the services with their commands and ports. Its investigation is read-only. It never opens `.env` and never copies a secret value. The **Quick scan** is the fallback when no agent is around.

The proposal arrives with its services **selected**. **Details** shows each one's confidence and evidence, and what **could not be verified** is listed apart, which is not proof of absence. **Use the selected services** saves them; nothing starts yet.

| English | العربية |
| --- | --- |
| ![Run: the agent's proposal](images/tour/07-setup-plan-en.webp) | ![التشغيل: اقتراح الوكيل](images/tour/07-setup-plan-ar.webp) |

### 10. One approval, for the exact commands

One card shows **exactly** what will run on your machine: each command, and under Details its folder, environment variable names and the files the approval is bound to. **▶ Approve and start the app** approves them together and starts the app. If any of those later changes, the approval ends until you review it again.

| English | العربية |
| --- | --- |
| ![Your approval](images/tour/08-setup-trust-en.webp) | ![موافقتك](images/tour/08-setup-trust-ar.webp) |

### 11. From now on: ▶ Start project

Once the services are approved, **the Run tab is the control page**. One state sits on top, with **▶ Start project** and **■ Stop project**, the apps to **open quickly**, and one compact row per service with Start, Restart, Stop and Logs. Start project starts the services in dependency order and waits for each one to be ready. Stop project stops only what YallaFlow started. It **never** stops shared infrastructure, such as a Docker stack or database that other projects use. Advanced editing (finding services, the stack, agents) is under **Settings**.

| English | العربية |
| --- | --- |
| ![Run the project](images/tour/09-setup-running-en.webp) | ![تشغيل المشروع](images/tour/09-setup-running-ar.webp) |

### 12. Same control on your phone

| English | العربية |
| --- | --- |
| <img src="images/tour/10-setup-mobile-en.webp" alt="Run on mobile" width="300"> | <img src="images/tour/10-setup-mobile-ar.webp" alt="التشغيل على الموبايل" width="300"> |

### 13. All your projects in one place

**All projects** lists every project on this machine with its open and done work and its running agents. **Needs you** on top collects the agent requests from every project. From here you add an existing project or create a new one.

| English | العربية |
| --- | --- |
| ![All projects](images/tour/11-projects-en.webp) | ![كل المشاريع](images/tour/11-projects-ar.webp) |

---

## What stayed true on every screen

- **Nothing runs on its own.** Opening the console starts nothing. A service runs only after you approve its command, and an agent starts only when you send it a message.
- **No secrets leave your files.** Analysis never opens `.env`, plans list environment variable *names* only, and logs are redacted on a best-effort basis.
- **Human decisions stay human.** Creating a project, approving a command, stopping shared infrastructure and approving review gates all need you.
- **Local only.** There is no YallaFlow server, no account and no telemetry. Your project state lives in `.yallaflow/`, in your repository.

Next: [Install or upgrade →](../README.md#install) · [Console reference →](console.md) · [Runtime reference →](runtime.md)
