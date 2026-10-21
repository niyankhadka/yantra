---
description: Make Yantra diagrams and answer pages from Claude.ai, ChatGPT, Gemini or any chat with the playground's copyable prompt, the Claude.ai skill or the custom GPT pack. Nothing to install.
---

# Use with Claude.ai, ChatGPT and any chat

A chat app cannot run Yantra, but it can write the JSON that Yantra draws. The
[playground](https://yantra.nbk.com.np/playground/) turns that JSON into the interactive result
in your browser: it validates it, previews it and downloads it. Nothing is uploaded, and it
keeps working offline once loaded.

## Any chat, in four steps

1. Open the [playground](https://yantra.nbk.com.np/playground/) and press **Copy prompt for
   your chat**. (The same text is in
   [chat/prompt.md](../../chat/prompt.md).)
2. Paste it as the first message of a new chat, or into the app's custom instructions,
   project instructions or a Gemini Gem. Then ask, for example:
   - "Show how a card payment reaches the merchant's bank, step by step."
   - "Explain our onboarding process as a diagram: sign-up, verification, first project."
   - "Should we build or buy a CRM? One page."
3. The chat answers with one JSON code block. Copy it (the block's copy button is easiest)
   and paste it into the playground's editor. Pasting the whole reply works too: the
   playground takes the JSON out of the surrounding text.
4. Read the **Validation** list. Errors stop the preview: press **Copy prompt to fix this**
   and paste the result into the chat, which gets the JSON and the findings together. Warnings
   are worth fixing but do not stop the preview.

Then download what you need: **Standalone HTML** (the interactive file, the same as
`yantra build`), **SVG** or **PNG** (diagrams), **Markdown** (for a ticket or wiki) or the
**JSON** to keep and edit later.

## What the Copy prompt button copies

The button changes with the editor, so one click always gives the chat what it needs:

- **Empty editor** - *Copy prompt for your chat*: the instructions, then "Describe what you
  want: `<your request here>`".
- **A valid diagram or page** (an example or your own) - *Copy prompt with this diagram* (or
  *page*): the instructions, the JSON, then "Change this diagram: `<your request here>`".
  Use it to keep working on a result in a new chat.
- **JSON with errors or warnings** - *Copy prompt to fix this*: the instructions, the JSON,
  the first 20 findings with their codes, then "Fix these problems and return the full
  corrected JSON".

The arrow beside the button opens a **What do you want?** box. Type your request there and it
replaces the placeholder, so the chat can start straight away. **Instructions only** copies
the instructions without the JSON, for very large diagrams that a chat may cut short (the
playground warns when a prompt is over 60,000 characters).

**Load an example** in the playground opens any gallery example. It helps to show a chat what
you want: "make one like this, about our support process".

## Claude.ai skill

The skill teaches Claude when and how to answer with Yantra JSON, with the schemas and
examples alongside, so you do not need to paste the prompt each time.

1. Build the zip from a clone of the repository: `npm install`, then `npm run pack:skill`.
   It writes `dist-chat/yantra-skill.zip`.
2. In Claude.ai, open the skills settings (under Settings > Capabilities at the time of
   writing; skills need code execution turned on) and upload the zip.
3. Ask for a diagram in any chat. Claude replies with the JSON and the playground link.

## ChatGPT custom GPT

The files are in [chat/chatgpt/](../../chat/chatgpt/); `npm run pack:gpt` gathers them into
`dist-chat/yantra-gpt/`.

1. Create a GPT (Explore GPTs > Create) and open **Configure**.
2. Paste [instructions.md](../../chat/chatgpt/instructions.md) into **Instructions** and the
   lines of [conversation-starters.md](../../chat/chatgpt/conversation-starters.md) into
   **Conversation starters**.
3. Upload every file in `dist-chat/yantra-gpt/knowledge/` as **Knowledge**.
4. Save it, privately or shared by link.

App menus change often: if a step names a menu that has moved, check the app's current help.

## Tips for good results

- **Say what kind of output you want**: "a diagram", "a sequence diagram", "a state
  machine", "one page with a comparison", "a dashboard page with charts".
- **Give the facts**: paste the relevant notes, the list of services or the table of
  numbers. A chat will invent plausible details if you do not.
- **Ask for the story**: "with a walkthrough of 5 steps for a new team member".
- **Iterate in the chat**: "merge the two queue cards", "add a step for the refund", "use
  the Arabic language" (`meta.lang`).
- **Check the facts** before you share the file. The validator checks structure and
  geometry, not whether the content is true.

## Chat apps that can call tools

- **Claude Desktop** runs local MCP servers, so it can validate, build and screenshot by
  itself: see [Claude Desktop in the chat reference](../../docs/chat.md#claude-desktop).
- **Claude.ai and ChatGPT connectors** call an MCP server by URL. `yantra mcp --http` is that
  server, but you host it yourself: see [Releases and self-hosting](self-hosting.md).

The full reference, including the pack contents, is [AI chats](../../docs/chat.md).
