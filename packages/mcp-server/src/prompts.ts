/* Prompts — the other half of what a server owes its client.
 *
 * `instructions` on the server is about not BREAKING a document: tokens, string
 * keys, CSS prefixes, unique names. It is loaded whether anyone wants it or not,
 * and it is written for whoever is holding the pen.
 *
 * A prompt is the opposite: asked for by name, by somebody who wants to READ
 * this design and answer questions about it. Somebody handed a link to a
 * project has no idea that screens are items, that a flow is a named journey,
 * or that the kit pages are generated and not part of the product — and without
 * that, the first thing they do is describe the design system as if it were
 * five more screens.
 *
 * These are the questions people actually arrive with, phrased as instructions
 * to whoever answers them. They name tools, because the cheapest failure here
 * is an answer invented from a name instead of read from the document.
 */

import { z } from 'zod';

/** The narrow slice of the MCP server this file needs. */
export interface PromptRegistrar {
  registerPrompt(
    name: string,
    config: { title?: string; description?: string; argsSchema?: Record<string, unknown> },
    cb: (args: never) => unknown,
  ): unknown;
}

const message = (text: string) => ({
  messages: [{ role: 'user' as const, content: { type: 'text' as const, text } }],
});

/** What anyone reading a project has to know before they say anything about it.
 *
 *  Kept in one place and reused by the others, because every one of them goes
 *  wrong in the same way without it. */
const GROUND = `A Flowkit project is one JSON document. Read it with the tools; do not
guess from names.

  overview       the shape of it — counts, viewports, flows, unresolved problems
  list_nodes     the screens on the canvas, in flow order, with their titles
  list_edges     what leads to what, and what makes it happen
  get_item       one screen's markup, when the words on it matter
  list_components what the design is built from, and the states each part has
  get_strings    the copy, by key

Two things mislead newcomers, so hold them in mind:

  · A screen is an ITEM of tier "screen"; the canvas node that shows it is a
    separate record with the title, the flow it belongs to and its position.
    The node's title is what a person named it; the item name is the id.

  · The pages whose names start with "kit-" are GENERATED from the registry.
    They are the design system's own documentation, not part of the product.
    Never describe them as screens of the application.`;

export function registerPrompts(server: PromptRegistrar): void {
  server.registerPrompt(
    'explain-flow',
    {
      title: 'Explain a journey',
      description:
        'Walk one flow end to end — what a person is trying to do, the path they take, and ' +
        'what happens when it goes wrong.',
      argsSchema: {
        flow: z
          .string()
          .optional()
          .describe('The flow id. Omit to cover the whole canvas, flow by flow.'),
      },
    },
    (args: never) =>
      message(
        `${GROUND}

Explain ${(args as { flow?: string }).flow ? `the "${(args as { flow?: string }).flow}" flow` : 'this project, one flow at a time'}.

Read list_nodes and list_edges first, then the screens that carry the decisions.
Tell it as a journey, not as an inventory:

  · what the person is trying to do, and what they have to hand at the start
  · the path when everything works, in order, naming screens by their titles
  · every branch off it — what makes it happen, from the connection's own label
  · where it can end without succeeding, and what the design offers there

Quote the words actually on the screens when a decision hangs on them; a
condition somebody has to tick is worth quoting exactly. If the graph is
incomplete — a screen nothing leads to, a branch with no way back — say so
plainly rather than inventing a link. An edge marked as assumed was guessed by
the importer from screen order and is not somebody's decision; treat it as a
question, not a fact.`,
      ),
  );

  server.registerPrompt(
    'review-screen',
    {
      title: 'Review a screen',
      description:
        'Check one screen against what this design already decided elsewhere, rather than ' +
        'against taste.',
      argsSchema: { screen: z.string().describe('The screen item name.') },
    },
    (args: never) =>
      message(
        `${GROUND}

Review the screen "${(args as { screen: string }).screen}".

Render it before saying anything about it — render_screen at each viewport in
the project. Valid markup is not a working layout, and only the picture shows
text that overflowed, a control that wrapped, or contrast that vanished.

Then judge it against THIS design rather than against general taste:

  · does it use the parts the registry already has, or has it re-made one by
    hand? list_components says what exists.
  · are its colours and sizes tokens? validate reports literals.
  · does every visible string carry a key? Text without one cannot be
    translated, and validate reports that too.
  · does it belong to a flow, and do its connections say what leads out of it?

Report what is wrong and what to do instead. Where the design has already
answered the same question on another screen, name that screen — consistency
with a decision already made is worth more than a better idea taken alone.`,
      ),
  );

  server.registerPrompt(
    'write-spec',
    {
      title: 'Write a specification',
      description:
        'Turn the design into something a developer can build from: screens, states, copy, ' +
        'and what leads where.',
      argsSchema: {
        flow: z.string().optional().describe('Limit it to one flow. Omit for the whole project.'),
      },
    },
    (args: never) =>
      message(
        `${GROUND}

Write a specification${(args as { flow?: string }).flow ? ` for the "${(args as { flow?: string }).flow}" flow` : ' for this project'}, for somebody who will build it and has not
seen the design.

Structure it as: what the product does, then a section per flow, then a section
per screen inside it. For each screen give

  · its purpose in one sentence, and where it sits in the journey
  · what is on it, in the order it is read
  · the states it has, and what puts it in each
  · what leads in and what leads out, with the condition on each connection
  · anything recorded in its meta — roles, endpoints, rules — quoted as written

Export the pictures with export_png and refer to them; a spec without them is
half a spec. Take the copy from get_strings rather than retyping it, so the
words in the spec are the words that will ship.

Say what the design does NOT answer as its own section. A specification that
hides its gaps is worse than one that lists them, because somebody will fill
them in silently while building.`,
      ),
  );

  server.registerPrompt(
    'extract-part',
    {
      title: 'Lift a part out of the screens',
      description:
        'Turn repeated markup into a registry item — where the boundary goes, how a state is ' +
        'expressed, and how to know it did not change the design.',
      argsSchema: {
        part: z
          .string()
          .optional()
          .describe('What to extract — a class name, or a description of the thing.'),
      },
    },
    (args: never) =>
      message(
        `${GROUND}

Extract ${(args as { part?: string }).part ?? 'the part worth extracting next'} into the registry.

COUNT BEFORE YOU CUT. Find every occurrence across the screens and see how they
actually differ. Nearly every "variant" turns out to be content, and a shape
that occurs once is not a component — it is that screen's markup, and lifting it
buys nothing while costing a name.

WHERE THE BOUNDARY GOES. The smallest thing a screen keeps is the element
carrying its string key. The default locale's text lives INLINE in the markup —
an empty element with a data-t renders empty, it is not filled from the strings
table — so the words and their key travel together, and they belong to the
caller. Everything around them is the part.

  part    <div class="row-bot"><div class="row-in"><x-slot/></div></div>
  screen  <x-msg-bot><p data-t="…">It is done, three days early.</p></x-msg-bot>

Put the key on the component instead and every use of it shares one key — sixty
messages with the same sentence.

REPETITION IS A FILL, NEVER A VARIANT. There are no loops. A card with two, three
or five chips is one part whose caller lists the chips; three variants would be
three copies drifting apart.

A STATE HAS THREE MECHANISMS, and most need only the first:
  class   the design already styles a modifier — .status.is-review
  attrs   a class cannot say it — aria-pressed, aria-selected, disabled, where
          the design's own rule is .comp-send[disabled]
  html    the state really is different ELEMENTS — a panel with a scrim behind
          it. Give it the same slots as the base, or a fill lands nowhere.
Splitting a state into a second item says they are two things. Usually they are
not, and whoever later turns this registry into code needs to see one part with
its states.

THE TRAP THAT COSTS THE MOST TIME. Moving a key onto a wrapper collapses flex
gaps. If the parent is a flex row with a gap, the value must be a SIBLING of the
label, not a wrapper around both — three children give three gaps, one wrapper
gives one, and the words close up. It looks like nothing until you compare.

WHICH IS WHY YOU COMPARE. render_screen every touched screen BEFORE the change
and after, at every viewport, and check they are identical. Extraction is meant
to change nothing on screen; if a picture moved, the boundary is wrong. Then
build_kit, and look at the sheet — a part that renders as an empty box there is
telling you something.

Finally: name the sheets that draw it (update_item_sheets), or it renders
unstyled and validate says so.`,
      ),
  );

  server.registerPrompt(
    'orient',
    {
      title: 'Get oriented',
      description: 'What this project is, before answering anything about it.',
      argsSchema: {},
    },
    () =>
      message(
        `${GROUND}

Start with overview, then list_nodes. Report back, briefly:

  · what the product appears to be, from the screens and their titles
  · the flows, and how many screens each holds
  · what the design system already has — list_components
  · what validate says is unresolved

Do not read every screen's markup to answer this. Read broadly first; read one
screen closely only when a question is actually about it.`,
      ),
  );
}
