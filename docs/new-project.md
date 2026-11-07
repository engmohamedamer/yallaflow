# New Project Wizard (1.4.0)

`yallaflow new` and the console's **New project** page (from **All projects**) create a genuinely new project: you describe it, choose the location, stack and environment, review a plan with the exact commands, then confirm. YallaFlow then runs the official generator, initializes YallaFlow and opens a first work item for your agent. Linux and macOS.

## In the console: four steps

1. **Idea.** The project name, what you want to build, optional requirements and context, and optional attachments (BRD, Word, PDF, Markdown, screenshots). Choose the location with **Choose folder**: it lists folders inside your home folder only (directories, never files; hidden folders are not shown; a link that leads outside home is not listed) and marks Git repositories, YallaFlow projects and empty folders. Typing a path is an advanced option; like `yallaflow new plan`, it can name any folder you can write to, and the project created there is added to the console too.
2. **Stack.** The stacks below, grouped as full-stack, frontend, backend and blank, each with what it gives you and its trade-offs. A recommendation from your agent is not available in this step yet.
3. **Environment.** Docker, local tools or decide later, with the tools found on this machine (checked with their version flag only; nothing is installed). Docker is recorded as planned: no Docker files are created yet. **Initialize a local Git repository** is on by default: it runs `git init` only, with no remote, commit or push.
4. **Review & create.** A summary (project, purpose, location, stack, environment, Git, requirements, attachments), what will and will not happen, and the commands under **Technical details**. **Create the project** carries out exactly this plan: the page sends the plan's full hash, and a changed or different plan is refused. A plan that installs dependencies (runs package scripts) also asks you to type the project name.

When it finishes, the console adds the project to its list (once, even if you retry) and opens its **Overview**: a setup checklist with the goal, requirements, stack, environment, Git, runtime, agent and the first work item with its next step. Attached files are linked to the first work item; only files whose size and SHA-256 match the plan are accepted. If adding the project to the console fails, the page says the project exists and offers **Add it to the console**, which never creates a second project.

The console also starts with no saved project at all (not with `--read-only`), so the first project can be created from the browser.

## Stacks

Each stack runs one official generator, pinned to an exact version:

| Stack | Command (`<name>` is your project name) |
|---|---|
| Laravel | `composer create-project laravel/laravel:13.11.0 <name> --no-interaction --prefer-dist` (needs PHP 8.3+ and Composer; installs dependencies and runs Laravel's own setup scripts) |
| React + Vite | `npx --yes create-vite@9.3.4 <name> --template react-ts --no-interactive --no-immediate` |
| Vue + Vite | `npx --yes create-vite@9.3.4 <name> --template vue-ts --no-interactive --no-immediate` |
| Next.js | `npx --yes create-next-app@16.4.5 <name> --ts --app --eslint --tailwind --use-npm --skip-install --disable-git --import-alias @/* --yes --no-agent-feedback` |
| NestJS | `npx --yes @nestjs/cli@12.0.12 new <name> --package-manager npm --skip-git --skip-install --no-observe` |
| Empty | no command; an empty folder |

- **Nothing else runs.** No user-supplied command, template URL or package name is accepted. These generators download packages from the npm registry or Packagist, so they need the network.
- **Dependency install.** For the Node.js stacks it is a separate step (`--install`, `npm install`). It is shown in the plan and runs only if you choose it.
- **Prerequisites.** These are checked with `--version` only, and never installed for you.

## Plan, review, create

```bash
yallaflow new catalog
yallaflow new plan --name shop --parent ~/code --stack laravel \
  [--description TEXT] [--requirements TEXT] [--environment docker|local|later] [--git]
yallaflow new show NP-…                 # review it again
yallaflow new create NP-… --confirm <first 8+ characters of the plan hash>
yallaflow new discard NP-…              # remove the staging folder of a failed attempt
```

- **The plan.** It shows the destination, the stack, the generator and version, every command with its network, dependency-install and package-script effects, the expected structure and the prerequisites.
  - It is stored, immutable, in your user config folder (`$XDG_CONFIG_HOME/yallaflow/new-projects/`), never in a repository.
  - When you confirm, YallaFlow re-derives the command from its catalog, so an edited plan file cannot run anything else.
- **The destination.** It must not exist. A parent inside an existing repository or YallaFlow workspace is refused unless you pass `--allow-nested`.
- **Creation.** The generator runs in a fresh staging folder next to the destination (argv only, a minimal environment, its own process group, a 15-minute limit). Its output is moved into place **only if the destination is still absent**. Existing folders are never overwritten or re-labelled.
- **npm isolation.** For the npm-based stacks, staging gets its own minimal `package.json`, so npm treats it as the project root and a parent folder's `.npmrc` or `node_modules` cannot change what runs. Before running, YallaFlow asks npm for its project root and stops if it is not the staging folder (for example, a parent `package.json` whose `workspaces` capture it).
- **The destination is claimed exclusively** (it must not exist even as an empty folder). Later steps run only in the folder this plan created: if it was replaced, nothing is installed, initialized or labelled there.
- **Confirming is a human decision.** `new create` runs from a terminal or from the console's confirmed page. A script or an agent's tool call is refused. This guards against automation confirming its own plan; it is not a security boundary against a process that controls your user account.
- **Failure.** Nothing is promoted. Staging and the full generator log are kept for diagnosis, and retry skips the steps that already finished.
- **After creation.** YallaFlow's Core `init` runs as a new (Greenfield) project and records the provenance (`project.origin`: generator, version, stack, plan hash, and the environment and Git choice when given). With `--git`, `git init` runs (no remote, no commit). A first, unrouted work item is created and not made active: its title is short (`<name>: <your goal>`, or `Set up <name>`), and its request keeps your description and requirements word for word. No acceptance criteria or architecture are invented. From the command line, add the project to the console with `yallaflow console add <folder>`; the console's New project page does this itself.

## What "Greenfield" means here

A project created this way is Greenfield even though it already contains generated code, so it does not need an existing-project baseline. The generated code is **not** treated as understood or approved:
- no project-memory facts are created from it;
- `brief` and the Overview say "generated code not reviewed" (an empty project says "created empty");
- understanding grows from your intent, requirements and decisions.

Only a project created by `yallaflow new` gets this provenance. Existing repositories keep the normal discovery and baseline rules.

## Recommend for me

YallaFlow calls no model. `yallaflow new recommend` gives you a request for your own coding agent. The agent asks what you are building and runs `yallaflow new plan … --rationale "<why>"`. You then review that plan, including the rationale, and confirm it yourself.
