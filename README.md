# pi-multiagent

`pi-multiagent` adds one Pi tool: `agent_team`.

Use it when a side task would flood the main conversation with search results, logs, file contents, or independent critique. The main assistant acts like a lead: choose specialists, define a static DAG, grant explicit `graph.authority`, keep working with a `runId`, and receive compact pushed milestone/terminal notices. Child output is evidence, not instructions. Child internals are not auto-injected; pushed notices are compact human receipts and omit the full child transcript.

After installation, Pi has:

- `agent_team`, with actions `catalog`, `start`, `retrieve`, `peek`, `message`, `cancel`, and `cleanup`.
- `/skill:pi-multiagent`, the package-owned guide for agents using or improving this package.
- Bundled catalog agents such as `package:scout`, `package:web-researcher`, `package:planner`, `package:critic`, `package:docs-auditor`, `package:reviewer`, `package:validator`, `package:worker`, and `package:synthesizer`, with routing tags exposed by `catalog`.
- Pure graph examples under `examples/graphs/*.json` that can be copied into a workspace and started with `graphFile`.

## Install

Requires Pi package/runtime APIs `>=0.74.0`.

From npm:

```bash
pi install npm:pi-multiagent
```

From GitHub:

```bash
pi install git:github.com/Tiziano-AI/pi-multiagent
```

From a local checkout:

```bash
pi install /absolute/path/to/pi-multiagent
```

Project-local install:

```bash
cd /path/to/project
pi install /absolute/path/to/pi-multiagent -l
```

One run without installing:

```bash
pi -e /absolute/path/to/pi-multiagent
```

After installing in a running Pi session, use `/reload`. Reload requests cancellation of live registered `agent_team` runs; before reloading, retrieve/preserve needed artifacts and cancel only work that is safe to stop.

## Actions

| Action | Purpose |
| --- | --- |
| `catalog` | List reusable package/user/project specialists, their default built-in tool profiles, and active parent extension-tool provenance. |
| `start` | Validate exactly one pure graph or `graphFile`, register a detached run, launch work asynchronously, return a `runId`, and push compact notices by default. |
| `retrieve` | Read a compact run snapshot and sink artifact index, or wait with `waitSeconds` for a material parent-visible event or timeout, then return the same compact snapshot. Assistant text previews require `preview:true`; raw events require `debugEvents:true`. |
| `peek` | Inspect exactly one specialist's live/terminal artifact surface; assistant text previews require `preview:true`, and finalized steps include artifact paths. |
| `message` | Queue a bounded live parent message to one running step through the `steer` or `follow_up` child RPC channel; acceptance is delivery evidence, not compliance proof. |
| `cancel` | Request cancellation of a live detached run. |
| `cleanup` | Delete retained artifacts for a terminal run only when that evidence is no longer needed. |

`start` returns a usable registered `runId` or leaves no child process alive. Parent abort before registration cancels setup; parent abort after `runId` does not kill the detached run. Normal supervision is fire-and-forget: compact notices are pushed back to the parent as steer messages, while `retrieve` and `peek` remain explicit reads. `retrieve.waitSeconds` is a bounded wait/read convenience; it wakes on material parent-visible events, not routine assistant/tool activity. Use `cancel`, timeout, max-run expiry, terminal finalization, or `cleanup` for lifecycle closure. Live and retained run registries are process-local; on Pi session shutdown or reload the extension requests cancellation of live registered runs, but `agent_team` is not crash-resumable and in-memory `runId`s should not be treated as recoverable after reload.

README examples are `agent_team` tool inputs, not shell commands. This README is the human/operator path for install, trust boundaries, first run, lifecycle, limits, and validation. `/skill:pi-multiagent` is the complete canonical agent-facing reference and progressive-disclosure hub; its cookbook/reference assets carry deeper graph choreography for agents, while graph examples are schema-checked copyable specs.

| Action | Required controls | Optional controls |
| --- | --- | --- |
| `catalog` | none | `library.sources`, `library.query`, `library.projectAgents` |
| `start` | exactly one `graph` or `graphFile` | `options.maxRunSeconds`, `options.terminalRetentionSeconds`, `options.notify` |
| `retrieve` | `runId` | `cursor`, `stepId`, `waitSeconds`, `maxBytes`, `preview`, `debugEvents` |
| `peek` | `runId`, `stepId` | `maxBytes`, `preview` |
| `message` | `runId`, `stepId`, `channel`, `text` | `clientMessageId` |
| `cancel` | `runId` | `reason` |
| `cleanup` | `runId` | none |

Do not send read-only controls such as `cursor`, `waitSeconds`, `maxBytes`, `preview`, or `debugEvents` to `catalog` or `start`. `catalog` is narrowed with `library.query`, not `maxBytes`. `preview` is retrieve/peek-only and defaults to `false`, so routine reads return status, diagnostics, step rows, artifact indexes, and artifact paths without child final text. `waitSeconds` is retrieve-only and returns the same compact snapshot after a material parent-visible event or timeout. Schema-admissible fatal shape failures render as `# agent_team error` with misplaced fields and repair copy instead of an empty action result; schema-invalid calls may be rejected by Pi before package rendering.

`options.notify` defaults to `mode:"milestones"`, `maxNotices:12`, and `minIntervalSeconds:10`. `mode:"none"` disables pushed notices. `mode:"final"` sends only the terminal notice. `mode:"milestones"` coalesces milestone reasons between sends; `maxNotices` caps non-terminal notices from 0 to 100, and the terminal notice is still sent unless mode is `none`.

Tool profile quick matrix:

| Step type | `agent.tools` | Authority needed | Result |
| --- | --- | --- | --- |
| Catalog read role, omitted tools | omitted | `allowFilesystemRead:true` | Inherits and expands the role's read/discovery `defaultTools`. |
| Catalog role, narrowed tools | explicit list | matching authority | Replaces the whole catalog profile; use `tools:["read","bash"]` for shell-backed read-only probes. |
| Catalog role, forced read-only | `[]` | `allowFilesystemRead:true` | Replaces any non-read catalog defaults, then mandatory read/discovery is added. |
| Inline role, omitted or read-only tools | omitted, `[]`, or `tools:["read"]` | `allowFilesystemRead:true` | Every child keeps the expanded `read`, `grep`, `find`, `ls` suite. |
| Web research role | omitted plus `extensionTools` | `allowFilesystemRead:true`, `allowExtensionCode:true` | Use `package:web-researcher` with catalog-reported web tool provenance; read tools let it inspect delegated local artifacts. |
| Mutation worker | omitted or write-capable explicit list | read/shell/mutation authority plus concrete first-class `mutationScope` | `mutationScope` is a planning requirement and child prompt handoff; it is not a path-level sandbox. |

## First success

Copy this pattern first:

- Use `catalog` to choose a specialist.
- For catalog agents, usually omit `agent.tools`; their `defaultTools` are inherited and capped by `graph.authority`. Explicit `agent.tools` replaces the whole catalog `defaultTools` profile, then mandatory read/discovery is added. It does not append; use it only to narrow or override the complete intended set.
- Write each delegated task as a small contract: objective, scope, sources/tools, output format, and stop condition.
- Let pushed notices be the manager inbox; use `retrieve` for intentional snapshot inspection or material-event bounded wait/read, `peek` for one step, artifact paths for full text, and `preview:true` only when bounded assistant text belongs in the parent context.
- Treat retained artifacts as durable handoff/context evidence. Preserve or intentionally discard them before `cleanup`.

1. Discover specialists:

```json
{
  "action": "catalog",
  "library": {
    "sources": ["package"],
    "query": "docs audit"
  }
}
```

2. Start a read-only docs audit. This catalog-agent example omits `agent.tools`, so the `package:docs-auditor` default profile is inherited and capped by graph authority.

```json
{
  "action": "start",
  "graph": {
    "objective": "Review whether the current repository has enough docs for a first-time operator.",
    "library": {
      "sources": ["package"]
    },
    "authority": {
      "allowFilesystemRead": true
    },
    "steps": [
      {
        "id": "review-docs",
        "agent": {
          "ref": "package:docs-auditor"
        },
        "task": "Review the current repository's README and adjacent docs for first-time operator clarity. Return findings first with severity, evidence path, operator impact, and concrete fix. Do not edit or run commands."
      }
    ]
  }
}
```

3. Let pushed notices report meaningful progress and terminal state. Use `retrieve` when you need an immediate compact snapshot or a bounded wait/read for material parent-visible events. Add `preview:true` only when you want bounded sink assistant text in the response:

```json
{
  "action": "retrieve",
  "runId": "agt_REPLACE_WITH_START_RUN_ID"
}
```

4. Peek at one step when you need its live text or non-sink final; set `preview:true` to include bounded assistant text:

```json
{
  "action": "peek",
  "runId": "agt_REPLACE_WITH_START_RUN_ID",
  "stepId": "review-docs",
  "preview": true
}
```

5. Message a live specialist only when a clarification or scope correction is worth interrupting its autonomous work:

```json
{
  "action": "message",
  "runId": "agt_REPLACE_WITH_START_RUN_ID",
  "stepId": "review-docs",
  "channel": "steer",
  "text": "Clarification: prioritize install and first-run docs if you have not already covered them. Do not stop early if the audit is still productively in progress."
}
```

6. Inspect any needed artifact paths from `retrieve` or `peek`. Cleanup after terminal state only when the retained evidence is no longer useful:

```json
{
  "action": "cleanup",
  "runId": "agt_REPLACE_WITH_START_RUN_ID"
}
```

If progress looks silent or output is missing, keep the parent context small without sacrificing useful child work: inspect the pushed notice, use `retrieve` with `waitSeconds` when you need to wait for the next material parent-visible event or timeout, `peek` exactly one step, send one bounded `message` only for clarification or scope repair, and use `debugEvents:true` only for package diagnostics. Do not demand a premature final, cancel, or cleanup just to tidy the transcript; let healthy live steps finish and read or preserve needed artifacts first.

### All-inline starter

Use inline agents when you want to hand-author a one-off team instead of using catalog refs. Inline agents do not inherit catalog defaults: omitted, empty, or read-only `tools` still receive mandatory read/discovery, while shell or mutation tools must be explicit and backed by graph authority. The tool cannot scope filesystem authority to exact files; keep file limits in each step's `system` and `task`.

```json
{
  "action": "start",
  "graph": {
    "objective": "Inline-only review of first-success docs.",
    "authority": {
      "allowFilesystemRead": true
    },
    "steps": [
      {
        "id": "read-readme",
        "agent": {
          "system": "Read only README.md. Report inline-agent UX gaps. Do not edit.",
          "tools": ["read"]
        },
        "task": "Assess whether README teaches inline agents, retrieve, peek, and retained-artifact handling clearly. Return three findings and two fixes."
      },
      {
        "id": "read-skill",
        "agent": {
          "system": "Read only skills/pi-multiagent/SKILL.md. Report inline-agent UX gaps. Do not edit.",
          "tools": ["read"]
        },
        "task": "Assess whether the package skill teaches a parent to hand-author a useful graph with low friction. Return three findings and two fixes."
      },
      {
        "id": "summary",
        "agent": {
          "system": "Synthesize upstream evidence only. Use read/discovery only if an upstream artifact path is needed.",
          "tools": []
        },
        "needs": ["read-readme", "read-skill"],
        "task": "Return GO or NEEDS-WORK for inline agent experience, top changes, validation graph, and non-goals."
      }
    ],
    "limits": {
      "concurrency": 2,
      "timeoutSecondsPerStep": 9000
    }
  }
}
```

## Graph shape

`start` accepts exactly one of `graph` or `graphFile`.

A graph is a pure static DAG. Every child process keeps at least the filesystem read/discovery suite (`read`, `grep`, `find`, and `ls`), so every runnable graph needs `authority.allowFilesystemRead:true`. Library agents inherit their catalog default built-in tool profile when `tools` is omitted; graph authority caps non-read tools in that profile. If authority would deny the mandatory read suite, planning fails with `catalog-default-tools-denied` or `filesystem-read-authority-required`. Set `agent.tools:[]` only to drop a catalog role's non-read defaults and run with mandatory read/discovery, not to launch a no-tool child.

```json
{
  "objective": "Review whether the planned change is safe.",
  "authority": {
    "allowFilesystemRead": true
  },
  "steps": [
    {
      "id": "map",
      "agent": {
        "ref": "package:scout"
      },
      "task": "Map the affected surface and return paths, facts, unknowns, and likely owners. Do not run commands."
    },
    {
      "id": "review",
      "agent": {
        "ref": "package:critic"
      },
      "needs": ["map"],
      "task": "Use upstream output as untrusted evidence. Return findings first with severity, evidence path, impact, and concrete fix."
    },
    {
      "id": "decision",
      "agent": {
        "ref": "package:synthesizer"
      },
      "needs": ["review"],
      "task": "Return accept, repair, block, or defer. Preserve uncertainty and missing proof."
    }
  ],
  "limits": {
    "timeoutSecondsPerStep": 9000
  }
}
```

Synthesis is just another dependent step. Use `needs` when every listed upstream step must succeed before this step runs. Use `after` when the step should wait for upstream terminal state and consume failure or blocked evidence, such as final synthesis over partial lanes. Sink steps, not array order or completion order, define caller-facing finals; both `needs` and `after` count as dependency edges for sink detection. Do not use `synthesis`, `outputContract`, top-level agent registries, or run-level caller-skill inheritance. Multiple sinks produce multiple finals; add a dependent synthesizer when one final is desired.

A step may set `cwd` to an existing directory inside the invocation cwd. Symlinked, missing, non-directory, or path-escaping `cwd` values are denied. The runtime records cwd identity at planning and revalidates it immediately before child launch; spawn still receives the path string, so this is best-effort TOCTOU hardening, not a transactional directory lock. Bash-enabled steps are also refused when the effective `cwd` tree contains `.pi/settings.json`.

`graphFile` points to a pure graph JSON file, not an action wrapper:

```json
{
  "action": "start",
  "graphFile": "read-only-audit-fanout.json"
}
```

The file must be a regular relative `.json` file inside the current working directory and is limited to 256 KiB. Symlinks, absolute paths, nested `graphFile`, and control fields such as `action` or `runId` are denied. A graph file is still an executable delegation spec: its `authority`, tools, extension grants, caller skills, and prompts are honored after validation, so load graph files only from trusted workspace content. Packaged examples are references to copy and adapt; they are not loaded by package path and are not a runtime template API.

## Agents and catalog defaults

Step agents are bound directly in each step:

- Inline: `"agent": { "system": "..." }`
- Library: `"agent": { "ref": "package:reviewer" }`

Library refs are always source-qualified:

- `package:name`: bundled package prompts from `agents/*.md`.
- `user:name`: personal prompts from `${PI_CODING_AGENT_DIR}/agents` or `~/.pi/agent/agents`.
- `project:name`: project prompts from nearest `.pi/agents`, available only when project code is explicitly trusted.

Bare names are invalid. Start graphs default to `graph.library.sources:["package"]`; opt into `user` or trusted `project` sources explicitly. Run `catalog` before using reusable agents; catalog output is authoritative for refs, descriptions, routing tags, default built-in tool profiles, paths, SHA metadata, and active parent extension-tool provenance. Catalog queries match exact phrases or non-stopword query terms across refs, descriptions, tags, sources, default tools, model, and path; omit the query to list everything.

Catalog descriptions and tags are model-facing routing contracts: prefer roles whose description or tags match the delegated job, then read the runtime `defaultTools`. Tags are routing metadata only; they do not grant tools, skills, source trust, shell, mutation, or release authority. Catalog defaults remove boilerplate, not authorization or ownership. Catalog output labels these as `defaultTools`. Structured details expose the same default built-in tool profile as `catalog[].tools`; do not confuse that metadata with step-level `agent.tools`. Omit `tools` on a library agent to inherit its catalog default profile capped by graph authority. If authority partially strips inherited defaults, start returns a `catalog-default-tools-capped` warning with the denied and effective tools; if authority would deny the mandatory read/discovery suite, start fails with `catalog-default-tools-denied` or `filesystem-read-authority-required`. Set `tools` explicitly only to narrow or override the complete profile; explicit `tools` replaces the whole catalog profile, then mandatory read/discovery is added. It does not append. Inline agents have no catalog defaults, but omitted or empty `tools` still receives mandatory read/discovery and requires `allowFilesystemRead:true`.

Package role chooser, with exact current `defaultTools` still owned by live `catalog` output:

| Ref | Reach for it when | Tool expectation |
| --- | --- | --- |
| `package:scout` | Local repo/dependency exploration: code, docs, tests, schemas, `.venv`, `node_modules`, generated clients, vendored SDKs, config, unknowns, contradictions | Default read/discovery; command-observed runtime facts require explicit `tools:["read","bash"]` plus shell authority. |
| `package:web-researcher` | Current external web facts, official/vendor docs, public announcements, registry facts, URLs, and provenance | Default read/discovery plus explicit `extensionTools` copied from `catalog`, with `allowFilesystemRead:true` and `allowExtensionCode:true`. |
| `package:planner` | Evidence exists and needs a scoped implementation contract | Read/discovery only. |
| `package:critic` | A concrete plan or completed path needs adversarial second-pass/pre-mortem risk review | Read/discovery only; not the default completed-work validator. |
| `package:docs-auditor` | Public docs, model-facing tool/skill copy, cookbook, examples, microcopy, or first-success UX need read-only clarity audit | Read/discovery only; command proof belongs to `package:validator`. |
| `package:reviewer` | Completed work, diffs, release candidates, public-copy drift, or validation evidence need normal review | Default read/discovery; command-only proof belongs to `package:validator`. |
| `package:validator` | Parent-named validation, status, diff, or test commands need observed shell proof without mutation | Default read/discovery plus bash; requires shell authority and concrete command scope. |
| `package:worker` | One parent-authorized implementation must edit synchronized surfaces | Defaults to read/discovery, bash, edit, and write; graph authority alone is not edit authorization. |
| `package:synthesizer` | Completed lanes need one decision while preserving conflicts | Default read/discovery so it can inspect upstream artifacts it receives; do not ask for fresh reconnaissance unless the task requires it. |

Any read/discovery primitive in `tools` resolves to the full filesystem read/discovery suite: `read`, `grep`, `find`, and `ls`.

## Authority and tools

Detached graphs deny elevated authority by default. Child processes inherit the parent OS environment and provider credentials needed to run Pi; filesystem, shell, mutation, extension-tool, and caller-skill grants can expose secrets and should be treated as trusted-code boundaries. Authority is graph-wide, so narrow individual catalog lanes with explicit `agent.tools` when a broad role's default profile is more than that lane should receive.

| Graph authority | Allows |
| --- | --- |
| `allowFilesystemRead` | The filesystem read/discovery suite: `read`, `grep`, `find`, and `ls`. |
| `allowShellTools` | Built-in `bash` for trusted bounded shell probes and commands. Bash can mutate through commands. |
| `allowMutationTools` | Structured built-in `edit` and `write`. |
| `allowExtensionCode` | Explicit `extensionTools` grants. |
| `allowProjectCode` | `project:` agents, project library sources, project/local extension sources, and project/temporary caller skill sources. |

Built-in child tools are limited to `read`, `grep`, `find`, `ls`, `bash`, `edit`, and `write`. Built-ins are launched by child Pi with `--tools`; they do not depend on which built-in tools happen to be active in the parent UI. Extension tools are different: they are trusted code loaded by source-qualified `extensionTools` grants and must be active in the parent catalog.

Explicit `tools` are strict: read/discovery, bash, edit, or write require matching graph authority, and read/discovery is mandatory for every child. Inherited catalog defaults are capped by authority, so a broad specialist can still be used read-only without repeating a lower-level tool list; inherited non-read defaults can be dropped with explicit `agent.tools:[]`, which still resolves to mandatory read/discovery. Because explicit `tools` replaces the whole catalog profile before mandatory read is added, a shell-backed read-only step should request `tools:["read","bash"]`, not `tools:["bash"]`. Write-capable steps and bash-capable `package:worker` steps also need concrete first-class `mutationScope`.

Example extension grant after `catalog` reports active Exa provenance. This is the `package:web-researcher` path; `examples/graphs/research-to-change-gated-loop.json` is local repository research and intentionally has no web tools:

```json
{
  "action": "start",
  "graph": {
    "objective": "Research current vendor documentation.",
    "authority": {
      "allowFilesystemRead": true,
      "allowExtensionCode": true
    },
    "steps": [
      {
        "id": "research",
        "agent": {
          "ref": "package:web-researcher",
          "extensionTools": [
            {
              "name": "exa_search",
              "from": { "source": "npm:pi-exa-tools", "scope": "user", "origin": "package" }
            },
            {
              "name": "exa_fetch",
              "from": { "source": "npm:pi-exa-tools", "scope": "user", "origin": "package" }
            }
          ]
        },
        "task": "Find and fetch the most relevant official documentation for the question. Return source URLs, source type, and provenance notes."
      }
    ],
    "limits": {
      "concurrency": 1,
      "timeoutSecondsPerStep": 9000
    }
  }
}
```

Extension grants load trusted code into child Pi processes with explicit `--extension` paths. This is code execution, not a tool-only sandbox. `package:web-researcher` still keeps mandatory read/discovery so it can inspect delegated local artifact paths named by the task.

## Caller skills

Detached runs do not inherit caller-visible skills by default. A step may request an explicit include-only list of caller-visible skills:

```json
{
  "id": "voice-review",
  "agent": {
    "system": "Use the named skill guidance and inspect files. Do not edit.",
    "tools": ["read"],
    "skills": ["voices-local-studio"]
  },
  "task": "Review the relevant voice workflow docs."
}
```

`tools:["read"]` expands to the full read/discovery suite. Skills require the read/discovery suite; skills never grant tools. Project-scoped, temporary-scoped, or workspace-local caller skill files require `graph.authority.allowProjectCode:true`. Child launch still uses `--no-skills` and then adds only selected verified `--skill` paths.

## Retrieve, peek, message, cancel, cleanup

`retrieve` is the compact manager read path. With no `waitSeconds`, it returns immediately. With `waitSeconds`, it waits until a material parent-visible event occurs or the timeout expires, then returns the same compact retrieve shape. Material events are run terminal/cancel/expiry, sink or targeted step finish, failed/blocked/timed-out/canceled step, or error diagnostic; routine assistant/tool activity does not wake the wait. It returns snapshots and does not stream child text. Graph sink finals are artifact-first. It returns:

- run status, objective, live step ids, sink step ids, counts, and last important event summary;
- step snapshots with compact `lastActivity` for silent live nodes;
- a first-class sink artifact index with step id, status, artifact path, and full-text character count;
- sink final previews only when `preview:true` is set, bounded separately from the full artifact files;
- diagnostics and action errors.

Use `cursor` from a prior retrieve call only when you need wait-from-that-point behavior or debug-event pagination/backfill. Use `stepId` on retrieve only to target material wait wakeups or debug-event filtering; use `peek` for one step's text/artifact. Optional `preview:true` includes bounded assistant text previews; default `preview:false` keeps retrieve and peek artifact/status-first. Optional `maxBytes` bounds returned preview text across sink outputs and debug-event text; it does not trim the full artifact files. The final model-facing response still has the compact formatter cap listed below. Default retrieve does not return raw event/protocol records. Set `debugEvents:true` only when package debugging needs raw background events.

`peek` is the microscope. It inspects exactly one `stepId`. By default it returns status, artifact path, and character counts without assistant text. With `preview:true`, a running step returns normal emitted assistant text so far; a terminal step returns that step's final preview and artifact path, including non-sink upstream-only steps. `maxBytes` bounds the returned preview; full terminal text remains in the artifact path.

Every finalized step writes a best-effort tmp artifact containing run/step metadata, status, agent ref/source, timestamps, and every non-empty assistant final in chronological order. A single assistant final is stored as the raw final text; multiple assistant finals are rendered as ordered `Assistant final N` sections so later turns do not overwrite earlier evidence. The canonical artifact path is the structured `StepOutput.filePath` value populated once when the step final is recorded; model-facing retrieve and peek text render that path as an artifact index before previews so truncation is less likely to hide it. A child that reaches terminal RPC state without non-empty assistant final text is marked failed rather than succeeded with an empty artifact. If artifact writing fails, terminalization continues with bounded text and a diagnostic but no artifact path. `retrieve` exposes sink artifacts and optional sink previews; `peek` exposes a single step artifact and optional preview. Pushed notices omit child-authored final text to keep parent context compact and show a human receipt with artifact names, not raw paths; use `retrieve` or `peek` when the parent needs artifact paths or text. Retained artifacts are useful handoff/context state for compaction, connection drops, later sessions in the same extension process, and chained graphs that quote artifact paths. Inspect, preserve, or intentionally discard needed artifacts before `cleanup`, because cleanup deletes them.

In interactive Pi, live detached work uses one pinned human operator panel while any graph is running. The panel updates in place, prioritizes live health, progress, active lanes, queued work, and attention states, and is cleared when the run terminalizes. Compact tool rows and pushed notice cards use the same human hierarchy for launches, status reads, stop receipts, and terminal receipts, so completed runs do not leave stacked live widgets or raw manager dumps.

`message` is the live clarification and scope-repair path, not a hurry-up button. It accepts `channel: "steer"` or `channel: "follow_up"`, one `stepId`, bounded text, and an optional `clientMessageId`. `steer` queues delivery after the current child assistant turn finishes tool calls and before the next LLM call. `follow_up` defers a live follow-up until the child is quiescent before terminalization, if still messageable. A successful receipt means Pi accepted the queued message; it does not prove the child obeyed, produced output, completed, or should stop early. Exact duplicate keys reuse the accepted receipt; reusing a key for different text is denied so a corrective message is not silently dropped. Parent message text is delivered to the child as an escaped JSON payload, so delimiter-looking text inside the message is data rather than message structure. Messages can only operate within the original delegated task: they cannot broaden scope, grant tools, authorize mutation, permit destructive/external actions, or force a half-done final unless the parent explicitly accepts incomplete evidence. Messages are denied after the step or run is terminal; terminal nodes are not reactivated.

`cancel` requests cancellation. Do not cancel only because a step is inconvenient or taking real time; first use bounded retrieve wait/read, targeted peek, or a scoped clarification when preserving child work matters. Cancel when the user explicitly chooses stopping, the work is unsafe, obsolete, stuck, or lower value than freeing capacity. `cleanup` is allowed only after terminal state and deletes package-owned retained artifacts.

## Boundaries

Each helper is a separate child Pi process launched in RPC mode with sessions, ambient extensions, context files, ambient skills, prompt templates, themes, and project `SYSTEM.md` disabled. A child receives the delegated graph objective, its step task/system prompt, explicit upstream dependency evidence, and selected tools/extensions/skills; it does not receive the parent transcript, parent session, ambient context files, or unselected skills/extensions. Production execution does not use Pi JSON print mode.

Control flow comes from schemas, manager state, process state, RPC responses/events, message queues, and manifests. Child-authored text never controls lifecycle. Graph sink steps define caller-facing final outputs; multiple sinks produce multiple finals.

`agent_team` is not an OS sandbox, not a secret filter, not transactional, and not crash-resumable. Inspect the workspace before retrying interrupted shell or mutation work.

## Limits

| Item | Limit |
| --- | --- |
| Steps | 16 |
| Dependencies per step | 12 |
| Concurrency | 1 to 6; default 6 |
| Per-step timeout | 1 to 36000 seconds; `timeoutSecondsPerStep` defaults to 7200 seconds |
| Max run time | 1 to 86400 seconds; default 86400 seconds |
| Terminal retention | 1 to 604800 seconds; default 86400 seconds |
| Retrieve wait | `waitSeconds` max 60 seconds |
| Live detached runs | 16 per extension process |
| Retained terminal runs | 64 per extension process |
| Pushed notices | `none`, `final`, or `milestones`; default `milestones`; max 100 non-terminal notices; default 12; minimum interval default 10 seconds, max 3600 |
| Inline upstream handoff | 12000 chars per dependency; larger upstream sends a 2000-char preview plus artifact path |
| Retrieve/peek model-facing output | Compact formatter cap is owned by Pi/package display; `preview` defaults false, and full artifacts are not trimmed |
| Final preview per step | Optional `preview:true`; 6000 chars plus full tmp artifact path |
| Graph file input | Relative `.json` file inside cwd; 256 KiB max |
| Agent file input | 128 KiB per library agent Markdown file |
| Retained events per run | 2000 |
| Per-event preview | 2000 chars |
| Parent message budget per live step | 16 message attempts or 65536 sent message chars |
| Retained assistant output per step | 4194304 bytes across non-empty assistant finals; max 64 non-empty assistant finals |
| RPC JSONL record parse cap | 8 MiB |

## Graph examples

Packaged examples are pure graph specs. Choose by authority first, then copy one into the current workspace, adapt it, and call `start` with `graphFile`. Use the graph design ladder in the skill/cookbook: no delegation, single specialist, inline fan-in, read-only fanout, artifact-chained follow-up, web research lane, web-to-local decision, human-gated plan, approved mutation run, then release/readiness foundry. Default to `single-specialist-read-only.json` or one catalog role. Use fanout only when independent lanes are explicitly valuable. Use artifact-chained decisions when prior retained artifact paths must cross compaction, approval, or phase boundaries; preserve terminal artifacts before cleanup. Use the cookbook-only Web Research to Local Decision pattern for current web facts plus local repo evidence after copying exact active catalog provenance and granting `allowExtensionCode:true`. Use mutation-capable graphs only after exact current mutation authorization. Do not run mutation-authority examples unless the user's current delegation explicitly authorizes the named mutation class. The first-class step `mutationScope` is both the copy/adapt contract and the planning-time prompt handoff for write-capable steps and bash-capable `package:worker` steps; replace it with the exact allowed file set or mutation class before starting the graph. `mutationScope` rejects missing or placeholder authorization but does not path-sandbox `bash`, `edit`, or `write`. Children do not receive the parent transcript and must not infer authorization.

Before starting a mutation-capable graph, verify all four items: exact parent authorization for the mutation class, concrete `mutationScope` naming the file set or mutation class, graph authority limited to the needed read/shell/mutation grants, and no placeholder or `REPLACE` text left in mutationScope fields. Graph gates are model-level dependencies, not human approval checkpoints; use separate runs when a human decision must occur before mutation.

| Example | Use when | Authority | Can mutate? | Concurrency | Sink | Parent authorization |
| --- | --- | --- | --- | --- | --- | --- |
| [`single-specialist-read-only.json`](examples/graphs/single-specialist-read-only.json) | One scoped local question needs one package specialist | filesystem read | No | one step | `inspect` | Read-only delegation |
| [`inline-read-only-fanin.json`](examples/graphs/inline-read-only-fanin.json) | Hand-authored inline lanes are faster than catalog routing | filesystem read | No | parallel read lanes | `summary` | Read-only delegation |
| [`human-gated-plan-only.json`](examples/graphs/human-gated-plan-only.json) | A plan and human approval question are needed before any mutation | filesystem read | No | parallel/serialized read lanes | `final-decision` | Read-only planning delegation |
| [`artifact-chained-decision.json`](examples/graphs/artifact-chained-decision.json) | Prior retained artifacts need a follow-up decision after compaction, approval, or phase separation | filesystem read | No | parallel read/review lanes | `final-decision` | Prior run id and artifact paths; preserve evidence before cleanup |
| [`approved-plan-implementation.json`](examples/graphs/approved-plan-implementation.json) | A prior read-only plan has exact current human approval and needs one authorized mutation run | filesystem, shell, mutation | Yes | serialized | `final-decision` | Exact approval text, prior artifact paths, concrete `mutationScope`, exclusions, and command scope |
| [`command-validation-only.json`](examples/graphs/command-validation-only.json) | Named read-only commands need observed proof without review bloat | filesystem, shell | No | serialized | `final-proof` | Read-only validation delegation with named commands |
| [`read-only-audit-fanout.json`](examples/graphs/read-only-audit-fanout.json) | Independent contract/docs/risk review before a decision | filesystem read | No | parallel read lanes | `final-decision` | Read-only delegation |
| [`completed-proof-review.json`](examples/graphs/completed-proof-review.json) | Completed change or release candidate needs observed proof without mutation | filesystem, shell | No | parallel review/proof lanes | `final-decision` | Read-only validation delegation with named commands |
| [`model-facing-docs-audit.json`](examples/graphs/model-facing-docs-audit.json) | Tool/skill/cookbook/catalog model-facing clarity needs a read-only audit | filesystem read | No | parallel audit lanes | `final-opportunities` | Read-only delegation |
| [`research-to-change-gated-loop.json`](examples/graphs/research-to-change-gated-loop.json) | Ambiguous local repo change needs evidence, plan, critique, and human-gated next action | filesystem read | No | parallel/serialized read lanes | `final-report` | Read-only planning delegation |
| [`docs-examples-alignment.json`](examples/graphs/docs-examples-alignment.json) | Docs/examples/tests need alignment after implemented behavior changes | filesystem, shell, mutation | Yes, docs/examples/tests only | serialized | `alignment-summary` | Explicit docs mutation authorization plus concrete `mutationScope` |
| [`implementation-review-gate.json`](examples/graphs/implementation-review-gate.json) | One scoped authorized package change needs map/plan/critique/work/review | filesystem, shell, mutation | Yes | serialized | `final-decision` | Explicit implementation authorization plus concrete `mutationScope` |
| [`public-release-foundry.json`](examples/graphs/public-release-foundry.json) | Release-readiness review before human-owned release actions | filesystem, shell, mutation | Yes, release-readiness fixes only | serialized | `ship-decision` | Explicit release-fix authorization plus concrete `mutationScope`; never version bump, commit, tag, push, publish, or create releases |

For current web facts, use `package:web-researcher` with the Exa extension grant pattern above, the cookbook Web Research Extension Lane, or the cookbook-only Web Research to Local Decision pattern. Require official or primary sources, fetched URLs, source/provenance notes, and exact active catalog provenance for extension grants. The research-to-change example is read-only local repository research and planning, not web research and not mutation.

## Troubleshooting quick checks

| Symptom | Check |
| --- | --- |
| `run` is rejected | Use `start`, then `retrieve`; `run` is intentionally absent. |
| Catalog has no expected role | Omit the query to list all roles, or use exact phrases/non-stopword routing terms that match descriptions or tags; check `library.sources` and whether the role is package, user, or trusted project. |
| Bare ref is rejected | Use a source-qualified ref such as `package:reviewer`. |
| Project agents do not load | For start graphs, set both `graph.library.sources:["project"]` and `graph.authority.allowProjectCode:true`; for catalog, use `library.sources:["project"]` with `projectAgents:"allow"` only for trusted repos. |
| `graphFile` is rejected | Use a pure relative graph JSON file inside cwd; do not include `action`, `runId`, or nested `graphFile`. |
| Built-in tool is rejected | Add `allowFilesystemRead:true` for the mandatory read/discovery suite, add shell/mutation authority only when intended, or set `agent.tools:[]` to drop non-read catalog defaults while keeping mandatory read/discovery. |
| Extension tool is rejected | Keep extension grants in `extensionTools` and copy source/scope/origin from `catalog`. |
| Bash child is refused | Step cwd is inside a tree with `.pi/settings.json`; remove `bash`, change cwd, or run outside that settings tree. |
| Message is denied or seems ignored | The target step may not be live, the run may be terminal/canceling, the per-step message budget may be spent, or the accepted message may still be queued. Use `steer` for active-run intervention, `follow_up` for a deferred live follow-up before terminalization when the child is quiescent, then retrieve/peek before canceling. |
| Need upstream output | Use `peek` with that step id; add `preview:true` for bounded assistant text, or read the artifact path for full text. Default `retrieve` exposes sink artifact indexes and, when available, compact non-sink terminal artifact paths. |
| Live step has no text yet | Use compact `retrieve` first and check step `lastActivity`; add `preview:true` only when text belongs in context; use retrieve `waitSeconds` to wait for a material parent-visible event or timeout without polling; for package debugging use `debugEvents:true` to distinguish raw protocol events. |
| Terminal step has empty final text | Treat it as failed evidence. Current runtime marks empty assistant finals failed with `assistant-final-empty`; inspect `errorMessage`, `lastActivity`, `peek`, artifact metadata, and `debugEvents:true` before cleanup. |
| Need raw event records | Use `retrieve` with `debugEvents:true`; default retrieve is intentionally compact. |
| Action rejects fields | For schema-admissible misplaced controls, read the `# agent_team error` repair line. Remove controls from the wrong action: `cursor` and `debugEvents` are retrieve-only; `preview` and `maxBytes` are for `retrieve` and `peek`, not `catalog`. Unknown or misplaced fields may be rejected by Pi schema validation before package rendering. |
| Cleanup is denied | Retrieve terminal state first; cleanup is not allowed for live runs. |

## Validate the package

```bash
cd /path/to/pi-multiagent
pnpm run gate
pnpm run check:release
npm pack --dry-run --json
npm publish --dry-run --json
git diff --check
```

`pnpm run gate` runs TypeScript typechecking, unit tests, fake Pi smoke, package-content checks, package-load checks, public-doc checks, and source-size checks. `pnpm run check:release` is the release identity guard: it checks package metadata, requires an empty `CHANGELOG.md` `Unreleased` section, requires a dated changelog section for the current package version, and verifies that version is not already published on npm.

Release candidates should also run the optional real-runtime smoke after explicit operator approval for a real Pi/model invocation:

```bash
PI_MULTIAGENT_REAL_SMOKE=1 pnpm run smoke:pi
```

`smoke:pi` is intentionally outside the deterministic gate; it launches the installed Pi RPC runtime with this package loaded and asks the configured model to exercise `agent_team catalog`.

For major rewrites, live integration changes, or release-readiness claims, static gates and toy smokes are not enough. Run a meaningful articulated graph, supervise it with pushed notices, compact `retrieve` for inspection, bounded `retrieve.waitSeconds` for material events, targeted `peek`, and `debugEvents:true` only for package debugging. Inspect or preserve terminal artifacts before deciding whether cleanup is appropriate. If the serious graph stalls, requires manual cancellation, or never reaches its sink final, treat the result as NEEDS-WORK rather than GO.

## Public npm release handoff

Publishing is human-owned. Do not run `npm publish`, git commit/tag/push, or GitHub release creation from `public-release-foundry.json` or another delegated graph.

Before the human publish step:

1. Confirm registry state and choose a version that is not already published:

   ```bash
   npm view pi-multiagent version versions dist-tags time --json
   ```

2. Set the chosen version in `package.json`.
3. Move release notes from `CHANGELOG.md` `Unreleased` into `## <version> - <YYYY-MM-DD>` and leave `Unreleased` empty.
4. Run and preserve output from:

   ```bash
   pnpm run gate
   pnpm run check:release
   npm pack --dry-run --json
   npm publish --dry-run --json
   PI_MULTIAGENT_REAL_SMOKE=1 PI_MULTIAGENT_REAL_SMOKE_TIMEOUT_MS=180000 pnpm run smoke:pi
   git diff --check
   ```

5. Inspect `npm pack --dry-run --json` for intended version, file list, size, no secrets, `pi` manifest, README, changelog, license, agents, assets, examples, skills, and extensions.
6. Preserve release validation artifacts, runIds, and command output before any `agent_team cleanup`.
7. Review, stage, commit, tag, and push according to the repository owner's policy so the exact published source is recoverable.

Stop here for agent-owned release prep. The human publisher then checks npm identity and performs the publish:

```bash
npm whoami
npm publish
```

For this unscoped public package, `publishConfig.access` is already `public`; `npm publish --access public` is acceptable but not required. The publisher owns any npm 2FA, token, provenance, or trusted-publishing decisions.

After publish, verify the public artifact:

```bash
npm view pi-multiagent@<version> version dist-tags time repository homepage license keywords peerDependencies pi dist.tarball dist.integrity --json
npm dist-tag ls pi-multiagent
pi install npm:pi-multiagent@<version>
```

Reload Pi and smoke `agent_team catalog`; verify `/skill:pi-multiagent` is available and the first-success example can start. Also verify the package image is reachable, for example `https://unpkg.com/pi-multiagent@<version>/assets/pi-multiagent-gallery.webp`.

Artifact cleanup:

- `agent_team cleanup` deletes retained run evidence; use it only after release evidence is preserved or intentionally discarded.
- `npm pack --dry-run --json` creates no `.tgz` file.
- If a non-dry-run `npm pack` is used, preserve its filename/integrity in the release record, then delete `pi-multiagent-<version>.tgz` only after publish verification or failed-release cleanup.

## Reference

- [`skills/pi-multiagent/SKILL.md`](skills/pi-multiagent/SKILL.md): complete canonical agent-facing invocation and maintenance guide.
- [`skills/pi-multiagent/references/graph-cookbook.md`](skills/pi-multiagent/references/graph-cookbook.md): agent-loadable graph choreography reference and copyable pattern library.
- [`examples/graphs`](examples/graphs): schema-checked pure graph examples.
