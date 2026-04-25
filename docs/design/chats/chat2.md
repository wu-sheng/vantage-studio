# Interaction interfaces documentation

_Started 2026-04-23 16:04 UTC_

---

## User

According to the latest chat, update `design note`, add which interaction interfaces are expected to support these pages.

## Assistant

I'll look at the current state of the project to understand what's there before updating the design note.

_[tool: list_files]_

_[tool: read_file]_

I need to understand the latest chat context. Let me check if there's additional context around interaction interfaces.

_[tool: grep]_

I don't have access to the "latest chat" context about which interaction interfaces are expected. The user says to update the design note per the latest chat — but I only see the design note content itself. Let me check the other jsx files for any mention of interfaces that might have been discussed:

_[tool: grep]_

_[tool: grep]_

_[tool: grep]_

_[tool: read_file]_

Since I don't have visibility into the "latest chat" discussing interaction interfaces, I need to ask. But looking at the existing design note, the subtitle says "UI + CLI exploration" — so the user likely wants this made explicit in the design note. The subtitle also mentions that these pages are built for multiple interfaces. 

Looking at the context: this is a SkyWalking runtime-rule admin. Standard SkyWalking interfaces are **Web UI (BanyanDB/OAP admin)**, **GraphQL API**, and **CLI (swctl)**. The subtitle explicitly notes "UI + CLI". I'll add an "Interaction interfaces" section to the design note covering what each page surface supports.

Let me update the design note to add a section listing expected interaction interfaces per page.

_[tool: str_replace_edit]_

The artboard height is 640 but content now overflows. Let me bump it so the new section is visible without scrolling.

_[tool: str_replace_edit]_

Note: I didn't have visibility into the specific "latest chat" you're referencing, so I inferred from the existing note's subtitle ("UI + CLI exploration") and standard SkyWalking conventions. Let me know if you meant a different set of interfaces and I'll adjust.

_[tool: done]_

Updated the `design note` artboard with a new **Interaction interfaces** section:

- Short prose framing: Web UI (this design) + GraphQL (OAP management API, the ground truth) + CLI (`swctl`, for scripting/CI).
- A 4-column matrix listing every page and marking parity per interface (● full / ◐ partial).

Extended the artboard to 1180px tall so it's all visible. If you meant a different set of interfaces (e.g. HTTP REST, gRPC, something custom), let me know and I'll swap the columns.

