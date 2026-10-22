/**
 * Starter templates: the smallest useful payload of each kind, valid with no
 * warnings (tests/starters.test.js). `yantra new` writes them and the
 * playground offers them under "Start from scratch".
 */

const steps = (list) => [{ id: 'main', name: 'Walkthrough', steps: list }];

export const STARTER_DIAGRAM = {
  meta: { title: 'New diagram', description: 'What this diagram explains, in one sentence.', layout: { direction: 'LR' } },
  roles: { actor: { label: 'Actor', color: 'amber' }, service: { label: 'Service', color: 'blue' }, store: { label: 'Data', color: 'violet' } },
  nodes: [
    { id: 'user', type: 'actor', data: { title: 'User', subtitle: 'Starts the flow', icon: 'user' } },
    { id: 'api', type: 'service', data: { title: 'API', subtitle: 'Validates and routes', tech: 'Node.js' } },
    { id: 'db', type: 'store', data: { title: 'Database', subtitle: 'Source of truth', tech: 'PostgreSQL', icon: 'database' } }
  ],
  edges: [
    { id: 'user-api', source: 'user', target: 'api', label: 'HTTPS request' },
    { id: 'api-db', source: 'api', target: 'db', label: 'SQL write' }
  ],
  scenarios: [
    {
      id: 'main',
      name: 'Happy path',
      steps: [
        { id: 'overview', title: 'Overview', description: 'The whole system at a glance.' },
        { id: 'request', title: 'Request arrives', description: 'The user calls the API.', highlightNodes: ['user', 'api'], highlightEdges: ['user-api'] },
        { id: 'persist', title: 'Data is stored', description: 'The API writes to the database.', highlightNodes: ['api', 'db'], highlightEdges: ['api-db'] }
      ]
    }
  ]
};

export const STARTER_SEQUENCE = {
  meta: { title: 'Sign in', description: 'Who calls whom, in order, when a user signs in.', view: 'sequence' },
  roles: { client: { label: 'Client', color: 'amber' }, service: { label: 'Service', color: 'blue' }, store: { label: 'Data', color: 'violet' } },
  nodes: [
    { id: 'browser', type: 'client', data: { title: 'Browser', subtitle: 'The user', icon: 'monitor' } },
    { id: 'api', type: 'service', data: { title: 'API', subtitle: 'Checks the request' } },
    { id: 'users', type: 'store', data: { title: 'Users DB', subtitle: 'Accounts', icon: 'database' } }
  ],
  edges: [
    { id: 'login', source: 'browser', target: 'api', label: 'POST /login' },
    { id: 'lookup', source: 'api', target: 'users', label: 'Find user' },
    { id: 'session', source: 'api', target: 'browser', label: 'Session cookie' }
  ],
  scenarios: steps([
    { id: 'send', title: 'Send the password', description: 'The browser posts the email and password.', highlightNodes: ['browser', 'api'], highlightEdges: ['login'] },
    { id: 'check', title: 'Check the account', description: 'The API finds the user and checks the password hash.', highlightNodes: ['api', 'users'], highlightEdges: ['lookup'] },
    { id: 'reply', title: 'Start a session', description: 'The API answers with a session cookie.', highlightNodes: ['api', 'browser'], highlightEdges: ['session'] }
  ])
};

export const STARTER_STATE = {
  meta: { title: 'Article lifecycle', description: 'The states an article moves through and the events between them.', layout: { direction: 'LR' } },
  roles: { state: { label: 'State', color: 'blue' }, done: { label: 'Final', color: 'green' } },
  nodes: [
    { id: 'start', type: 'state', shape: 'initial', data: { title: 'Start' } },
    { id: 'draft', type: 'state', shape: 'state', data: { title: 'Draft', subtitle: 'Being written' } },
    { id: 'review', type: 'state', shape: 'state', data: { title: 'In review', subtitle: 'An editor reads it' } },
    { id: 'published', type: 'done', shape: 'final', data: { title: 'Published' } }
  ],
  edges: [
    { id: 'create', source: 'start', target: 'draft', label: 'create' },
    { id: 'submit', source: 'draft', target: 'review', label: 'submit' },
    { id: 'reject', source: 'review', target: 'draft', label: 'reject' },
    { id: 'approve', source: 'review', target: 'published', label: 'approve' }
  ],
  scenarios: steps([
    { id: 'overview', title: 'Overview', description: 'Every state and the events that move an article on.' },
    { id: 'write', title: 'Write and submit', description: 'A draft goes to review when the author submits it.', highlightNodes: ['draft', 'review'], highlightEdges: ['submit'] },
    { id: 'decide', title: 'Approve or send back', description: 'The editor approves it, or rejects it back to draft.', highlightNodes: ['draft', 'review', 'published'], highlightEdges: ['reject', 'approve'] }
  ])
};

export const STARTER_ER = {
  meta: { title: 'Orders data model', description: 'Customers, their orders and the products in each order.', layout: { direction: 'LR' } },
  roles: { table: { label: 'Table', color: 'violet' } },
  nodes: [
    { id: 'customers', type: 'table', data: { title: 'customers', fields: [{ name: 'id', type: 'uuid', pk: true }, { name: 'email', type: 'text', unique: true }, { name: 'name', type: 'text' }] } },
    { id: 'orders', type: 'table', data: { title: 'orders', fields: [{ name: 'id', type: 'uuid', pk: true }, { name: 'customer_id', type: 'uuid', fk: true }, { name: 'total', type: 'numeric' }] } },
    { id: 'products', type: 'table', data: { title: 'products', fields: [{ name: 'id', type: 'uuid', pk: true }, { name: 'name', type: 'text' }, { name: 'price', type: 'numeric' }] } }
  ],
  edges: [
    { id: 'places', source: 'customers', target: 'orders', label: 'places', sourceEnd: 'one', targetEnd: 'zero-or-many', sourceField: 'id', targetField: 'customer_id' },
    { id: 'contains', source: 'orders', target: 'products', label: 'contains', sourceEnd: 'many', targetEnd: 'one-or-many' }
  ],
  scenarios: steps([
    { id: 'overview', title: 'Overview', description: 'Three tables and how they join.' },
    { id: 'orders', title: 'A customer places orders', description: 'Each order belongs to one customer through customer_id.', highlightNodes: ['customers', 'orders'], highlightEdges: ['places'] }
  ])
};

export const STARTER_CLASS = {
  meta: { title: 'Payment classes', description: 'The payment types and what they share.', layout: { direction: 'TB' } },
  roles: { base: { label: 'Abstract', color: 'slate' }, impl: { label: 'Class', color: 'blue' } },
  nodes: [
    { id: 'payment', type: 'base', data: { title: 'Payment', badge: 'abstract', fields: [{ name: 'amount', type: 'Money' }], methods: [{ name: 'authorise', type: 'Result' }] } },
    { id: 'card', type: 'impl', data: { title: 'CardPayment', fields: [{ name: 'last4', type: 'string' }], methods: [{ name: 'authorise', type: 'Result' }] } },
    { id: 'transfer', type: 'impl', data: { title: 'BankTransfer', fields: [{ name: 'iban', type: 'string' }], methods: [{ name: 'authorise', type: 'Result' }] } }
  ],
  edges: [
    { id: 'card-is', source: 'payment', target: 'card', relation: 'inheritance' },
    { id: 'transfer-is', source: 'payment', target: 'transfer', relation: 'inheritance' }
  ],
  scenarios: steps([
    { id: 'overview', title: 'Overview', description: 'One abstract payment and two kinds of it.' },
    { id: 'card', title: 'Card payments', description: 'A card payment is a payment with the card details.', highlightNodes: ['payment', 'card'], highlightEdges: ['card-is'] }
  ])
};

export const STARTER_TREE = {
  meta: { title: 'Team structure', description: 'Who reports to whom.', layout: { algorithm: 'tree', direction: 'TB' } },
  roles: { lead: { label: 'Leadership', color: 'violet' }, team: { label: 'Team', color: 'blue' } },
  nodes: [
    { id: 'ceo', type: 'lead', data: { title: 'Chief executive', subtitle: 'Runs the company', icon: 'user' } },
    { id: 'cto', type: 'lead', data: { title: 'Engineering', subtitle: 'Builds the product' } },
    { id: 'coo', type: 'lead', data: { title: 'Operations', subtitle: 'Runs the service' } },
    { id: 'web', type: 'team', data: { title: 'Web team', subtitle: '6 people' } },
    { id: 'data', type: 'team', data: { title: 'Data team', subtitle: '4 people' } },
    { id: 'support', type: 'team', data: { title: 'Support', subtitle: '8 people' } }
  ],
  edges: [
    { id: 'ceo-cto', source: 'ceo', target: 'cto' },
    { id: 'ceo-coo', source: 'ceo', target: 'coo' },
    { id: 'cto-web', source: 'cto', target: 'web' },
    { id: 'cto-data', source: 'cto', target: 'data' },
    { id: 'coo-support', source: 'coo', target: 'support' }
  ],
  scenarios: steps([
    { id: 'overview', title: 'Overview', description: 'The whole organisation.' },
    { id: 'eng', title: 'Engineering', description: 'Two teams report to engineering.', highlightNodes: ['cto', 'web', 'data'], highlightEdges: ['cto-web', 'cto-data'] }
  ])
};

export const STARTER_MINDMAP = {
  meta: { title: 'Launch plan', description: 'Everything a product launch needs, by theme.', layout: { algorithm: 'mindmap' } },
  roles: { topic: { label: 'Topic', color: 'blue' } },
  nodes: [
    { id: 'launch', type: 'topic', data: { title: 'Product launch' } },
    { id: 'build', type: 'topic', data: { title: 'Build' } },
    { id: 'tell', type: 'topic', data: { title: 'Tell people' } },
    { id: 'support', type: 'topic', data: { title: 'Support' } },
    { id: 'tests', type: 'topic', data: { title: 'Final tests' } },
    { id: 'blog', type: 'topic', data: { title: 'Blog post' } },
    { id: 'email', type: 'topic', data: { title: 'Email list' } },
    { id: 'faq', type: 'topic', data: { title: 'Help articles' } }
  ],
  edges: [
    { id: 'l-build', source: 'launch', target: 'build' },
    { id: 'l-tell', source: 'launch', target: 'tell' },
    { id: 'l-support', source: 'launch', target: 'support' },
    { id: 'b-tests', source: 'build', target: 'tests' },
    { id: 't-blog', source: 'tell', target: 'blog' },
    { id: 't-email', source: 'tell', target: 'email' },
    { id: 's-faq', source: 'support', target: 'faq' }
  ],
  scenarios: steps([
    { id: 'overview', title: 'Overview', description: 'Three themes around the launch.' },
    { id: 'tell', title: 'Telling people', description: 'A blog post and an email to the list.', highlightNodes: ['tell', 'blog', 'email'], highlightEdges: ['t-blog', 't-email'] }
  ])
};

export const STARTER_PAGE = {
  kind: 'page',
  meta: { question: 'What question does this page answer?', title: 'Short title', kicker: 'Explainer' },
  answer: {
    headline: 'The answer in one or two sentences - the conclusion comes first.',
    text: 'One short paragraph of context: why this is the answer.',
    points: ['First supporting point', 'Second supporting point', 'Third supporting point']
  },
  blocks: [
    { type: 'points', title: 'Key ideas', items: [{ title: 'Idea one', text: 'One sentence.' }, { title: 'Idea two', text: 'One sentence.' }, { title: 'Idea three', text: 'One sentence.' }] },
    { type: 'steps', title: 'How it works', span: 'half', items: [{ title: 'First', text: 'What happens.' }, { title: 'Then', text: 'What happens next.' }] },
    { type: 'callout', tone: 'warn', label: 'Watch out', span: 'half', body: 'The one thing people get wrong.' }
  ]
};

export const STARTER_BOOK = {
  kind: 'book',
  meta: { title: 'A short book', description: 'What the reader will understand by the end, in one sentence.', reading: 'book' },
  summary: 'The whole book in two or three sentences: the conclusion of every chapter, in order.',
  chapters: [
    {
      meta: { question: 'What is the first question?', title: 'The basics' },
      answer: { headline: 'The answer to the first question, in one or two sentences.', points: ['A supporting fact', 'Another supporting fact'] },
      blocks: [{ type: 'steps', title: 'In order', items: [{ title: 'First', text: 'What happens first.' }, { title: 'Then', text: 'What happens next.' }] }]
    },
    {
      meta: { question: 'What is the second question?', title: 'Going further' },
      answer: { headline: 'The answer to the second question, building on the first.' },
      blocks: [
        { type: 'metrics', title: 'Numbers', span: 'half', items: [{ label: 'A number that matters', value: '42%' }] },
        { type: 'callout', title: 'Remember', span: 'half', tone: 'info', body: 'The one thing to take away from this chapter.' }
      ]
    }
  ]
};

/** Every starter, in the order the playground lists them. `kind` matches the gallery's kinds. */
export const STARTERS = [
  { id: 'new-flow', kind: 'flow', name: 'Architecture or flow', description: 'Boxes and arrows: how parts connect and a request moves.', data: STARTER_DIAGRAM },
  { id: 'new-sequence', kind: 'sequence', name: 'Sequence', description: 'Who calls whom, in order: an API, a sign-in, a payment.', data: STARTER_SEQUENCE },
  { id: 'new-state', kind: 'state', name: 'State machine', description: 'The states of one thing and the events between them.', data: STARTER_STATE },
  { id: 'new-er', kind: 'data', name: 'Data model (ER)', description: 'Tables, their columns and how they join.', data: STARTER_ER },
  { id: 'new-class', kind: 'data', name: 'Class diagram', description: 'Classes, their members and how they relate.', data: STARTER_CLASS },
  { id: 'new-tree', kind: 'tree', name: 'Org chart or tree', description: 'A hierarchy: teams, a decision tree, a breakdown.', data: STARTER_TREE },
  { id: 'new-mindmap', kind: 'mindmap', name: 'Mind map', description: 'Ideas around one topic, branch by branch.', data: STARTER_MINDMAP },
  { id: 'new-page', kind: 'page', name: 'Answer page', description: 'One question answered: the conclusion first, then evidence.', data: STARTER_PAGE },
  { id: 'new-book', kind: 'book', name: 'Book', description: 'Several answer pages read in order, like an e-reader.', data: STARTER_BOOK }
];
