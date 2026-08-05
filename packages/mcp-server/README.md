# Olympus / Paperclip MCP Server

Model Context Protocol server for Olympus, with the complete legacy Paperclip
identity retained during the compatibility window.

This package is a thin MCP wrapper over the existing REST API. It does not talk
to the database directly and it does not reimplement business logic. The package
name and `PAPERCLIP_*` configuration variables remain unchanged for compatibility.

## Authentication

The server reads its configuration from environment variables:

- `PAPERCLIP_API_URL` - Paperclip base URL, for example `http://localhost:3100`
- `PAPERCLIP_API_KEY` - bearer token used for `/api` requests
- `PAPERCLIP_COMPANY_ID` - optional default company for company-scoped tools
- `PAPERCLIP_AGENT_ID` - optional default agent for checkout helpers
- `PAPERCLIP_RUN_ID` - optional run id forwarded on mutating requests

## Usage

```sh
npx -y @paperclipai/mcp-server
```

The package-default command and the explicit legacy command start the Paperclip
server identity. New consumers can select the Olympus server identity explicitly:

```sh
npx -y --package @paperclipai/mcp-server paperclip-mcp-server
npx -y --package @paperclipai/mcp-server olympus-mcp-server
```

Or locally in this repo:

```sh
pnpm --filter @paperclipai/mcp-server build
node packages/mcp-server/dist/stdio.js
node packages/mcp-server/dist/stdio-olympus.js
```

## Tool Surface

Both server identities expose the full compatibility surface. Every legacy
`paperclipX` tool below has an `olympusX` alias with the same suffix, casing,
input schema, and handler. For example, `paperclipGetIssue` maps exactly to
`olympusGetIssue`.

Legacy Paperclip tool names retained during the compatibility window:

Read tools:

- `paperclipMe`
- `paperclipInboxLite`
- `paperclipListAgents`
- `paperclipGetAgent`
- `paperclipListIssues`
- `paperclipGetIssue`
- `paperclipGetHeartbeatContext`
- `paperclipListComments`
- `paperclipGetComment`
- `paperclipListIssueApprovals`
- `paperclipListDocuments`
- `paperclipGetDocument`
- `paperclipListDocumentRevisions`
- `paperclipListProjects`
- `paperclipGetProject`
- `paperclipGetIssueWorkspaceRuntime`
- `paperclipWaitForIssueWorkspaceService`
- `paperclipListGoals`
- `paperclipGetGoal`
- `paperclipListApprovals`
- `paperclipGetApproval`
- `paperclipGetApprovalIssues`
- `paperclipListApprovalComments`

Write tools:

- `paperclipCreateIssue`
- `paperclipUpdateIssue`
- `paperclipCheckoutIssue`
- `paperclipReleaseIssue`
- `paperclipAddComment`
- `paperclipSuggestTasks`
- `paperclipAskUserQuestions`
- `paperclipRequestConfirmation`
- `paperclipUpsertIssueDocument`
- `paperclipRestoreIssueDocumentRevision`
- `paperclipControlIssueWorkspaceServices`
- `paperclipCreateApproval`
- `paperclipLinkIssueApproval`
- `paperclipUnlinkIssueApproval`
- `paperclipApprovalDecision`
- `paperclipAddApprovalComment`

Escape hatch:

- `paperclipApiRequest`
- `olympusApiRequest`

Both API request aliases are limited to paths under `/api` and JSON bodies. They
are meant for endpoints that do not yet have a dedicated MCP tool.
