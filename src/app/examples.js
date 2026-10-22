import sales from '../../examples/sales-pipeline.json';
import cloud from '../../examples/cloud-architecture.json';
import supplyChain from '../../examples/supply-chain.json';
import academic from '../../examples/academic-faculty.json';
import healthcare from '../../examples/healthcare-clinical.json';
import awsServerless from '../../examples/aws-serverless.json';
import oauthLogin from '../../examples/oauth-login.json';
import mlPipeline from '../../examples/ml-training-pipeline.json';
import supportEscalation from '../../examples/customer-support-escalation.json';
import manufacturing from '../../examples/manufacturing-quality.json';
import researchPaper from '../../examples/research-paper-lifecycle.json';
import healthReferralNepali from '../../examples/health-referral-nepali.json';
import orderFulfilmentArabic from '../../examples/order-fulfilment-arabic.json';
import orgChart from '../../examples/org-chart.json';
import studyPlan from '../../examples/study-plan-mindmap.json';
import triageTree from '../../examples/incident-triage-decision-tree.json';
import ecommerceSchema from '../../examples/ecommerce-schema.json';
import paymentClasses from '../../examples/payment-classes.json';
import platform from '../../examples/platform-overview.json';
import ticketLifecycle from '../../examples/ticket-lifecycle.json';
import parallelCheckout from '../../examples/parallel-checkout-states.json';
import smartCity from '../../examples/smart-city-operations.json';
import retailGroup from '../../examples/global-retail-group.json';
import hospitalTrust from '../../examples/hospital-trust-monitoring.json';
import liveOps from '../../examples/live-operations-dashboard.json';
import { registerStrings } from '../core/i18n.js';
import { TABLES } from '../core/locales/index.js';
import { PAGE_EXAMPLES, CHART_EXAMPLES, BOOK_EXAMPLES } from './gallery-pages.js';

// Gallery examples come in many languages: load every interface table (built files embed only theirs)
registerStrings(TABLES);

/** Built-in gallery, shown only when the page has no embedded payload. `kind` groups it in the playground. */
export const EXAMPLES = [
  { id: 'cloud-architecture', name: 'Online store: how an order is paid', kind: 'flow', data: cloud },
  { id: 'live-operations-dashboard', name: 'Online shop: live operations dashboard', kind: 'flow', data: liveOps },
  { id: 'aws-serverless', name: 'Web app on AWS serverless', kind: 'flow', data: awsServerless },
  { id: 'oauth-login', name: 'Sign in with OAuth 2.0 and PKCE', kind: 'sequence', data: oauthLogin },
  { id: 'ecommerce-schema', name: 'Online shop database (ER)', kind: 'data', data: ecommerceSchema },
  { id: 'payment-classes', name: 'Checkout classes (UML)', kind: 'data', data: paymentClasses },
  { id: 'platform-overview', name: 'Shop platform: overview with detail diagrams', kind: 'flow', data: platform },
  { id: 'smart-city-operations', name: 'Smart city sensors, six levels deep', kind: 'flow', data: smartCity },
  { id: 'global-retail-group', name: 'Retail group: boardroom to till (drill-down)', kind: 'flow', data: retailGroup },
  { id: 'hospital-trust-monitoring', name: 'Hospital trust: from the trust to one bed', kind: 'flow', data: hospitalTrust },
  { id: 'sales-pipeline', name: 'B2B sales: from lead to signed contract', kind: 'flow', data: sales },
  { id: 'supply-chain', name: 'Supply chain: raw materials to delivery', kind: 'flow', data: supplyChain },
  { id: 'academic-faculty', name: 'University: admission to graduation', kind: 'flow', data: academic },
  { id: 'healthcare-clinical', name: 'Hospital emergency care pathway', kind: 'flow', data: healthcare },
  { id: 'ml-training-pipeline', name: 'Machine learning: training to production', kind: 'flow', data: mlPipeline },
  { id: 'customer-support-escalation', name: 'Customer support escalation (modes)', kind: 'flow', data: supportEscalation },
  { id: 'manufacturing-quality', name: 'Factory quality checks', kind: 'flow', data: manufacturing },
  { id: 'research-paper-lifecycle', name: 'Research paper: idea to publication', kind: 'flow', data: researchPaper },
  { id: 'ticket-lifecycle', name: 'Support ticket states', kind: 'state', data: ticketLifecycle },
  { id: 'parallel-checkout-states', name: 'Checkout with parallel steps (fork / join)', kind: 'state', data: parallelCheckout },
  { id: 'org-chart', name: 'Company org chart', kind: 'tree', data: orgChart },
  { id: 'study-plan-mindmap', name: 'Exam revision plan', kind: 'mindmap', data: studyPlan },
  { id: 'incident-triage-decision-tree', name: 'Incident severity decision tree', kind: 'tree', data: triageTree },
  { id: 'health-referral-nepali', name: 'Patient referral, village to hospital (Nepali)', kind: 'flow', data: healthReferralNepali },
  { id: 'order-fulfilment-arabic', name: 'Order fulfilment (Arabic, right to left)', kind: 'flow', data: orderFulfilmentArabic }
];

/**
 * Example dropdown sections (labels are string keys in src/core/i18n.js). Answer
 * pages and chart pages live in ./gallery-pages.js; main.js shows them in a frame.
 */
export const GALLERY = [
  { id: 'diagrams', label: 'app.galleryDiagrams', items: EXAMPLES },
  { id: 'pages', label: 'app.galleryPages', items: PAGE_EXAMPLES },
  { id: 'charts', label: 'app.galleryCharts', items: CHART_EXAMPLES },
  { id: 'books', label: 'app.galleryBooks', items: BOOK_EXAMPLES }
];

/**
 * The playground's groups, in order: `kind` of a gallery entry or starter -> its label key.
 * An entry's one-line description is its own meta.description (or meta.question).
 */
export const KINDS = [
  ['flow', 'play.kind.flow'],
  ['sequence', 'play.kind.sequence'],
  ['state', 'play.kind.state'],
  ['data', 'play.kind.data'],
  ['tree', 'play.kind.tree'],
  ['mindmap', 'play.kind.mindmap'],
  ['page', 'play.kind.page'],
  ['chart', 'play.kind.chart'],
  ['book', 'play.kind.book']
];
