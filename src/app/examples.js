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
import { registerStrings } from '../core/i18n.js';
import { TABLES } from '../core/locales/index.js';

// Gallery examples come in many languages: load every interface table (built files embed only theirs)
registerStrings(TABLES);

/** Built-in gallery, shown only when the page has no embedded payload. */
export const EXAMPLES = [
  { id: 'cloud-architecture', name: 'Cloud architecture', data: cloud },
  { id: 'aws-serverless', name: 'AWS serverless (groups)', data: awsServerless },
  { id: 'oauth-login', name: 'OAuth sign-in (sequence)', data: oauthLogin },
  { id: 'ecommerce-schema', name: 'E-commerce schema (ERD)', data: ecommerceSchema },
  { id: 'payment-classes', name: 'Order classes (UML)', data: paymentClasses },
  { id: 'platform-overview', name: 'Shop platform (drill-down)', data: platform },
  { id: 'sales-pipeline', name: 'B2B sales pipeline', data: sales },
  { id: 'supply-chain', name: 'Supply chain', data: supplyChain },
  { id: 'academic-faculty', name: 'Academic lifecycle', data: academic },
  { id: 'healthcare-clinical', name: 'Emergency care pathway', data: healthcare },
  { id: 'ml-training-pipeline', name: 'ML training pipeline (groups)', data: mlPipeline },
  { id: 'customer-support-escalation', name: 'Support escalation (modes)', data: supportEscalation },
  { id: 'manufacturing-quality', name: 'Manufacturing quality (panel)', data: manufacturing },
  { id: 'research-paper-lifecycle', name: 'Research paper lifecycle', data: researchPaper },
  { id: 'ticket-lifecycle', name: 'Ticket lifecycle (states)', data: ticketLifecycle },
  { id: 'parallel-checkout-states', name: 'Parallel checkout (fork / join)', data: parallelCheckout },
  { id: 'org-chart', name: 'Org chart (tree)', data: orgChart },
  { id: 'study-plan-mindmap', name: 'Revision plan (mind map)', data: studyPlan },
  { id: 'incident-triage-decision-tree', name: 'Incident triage (decision tree)', data: triageTree },
  { id: 'health-referral-nepali', name: 'Patient referral (Nepali)', data: healthReferralNepali },
  { id: 'order-fulfilment-arabic', name: 'Order fulfilment (Arabic, RTL)', data: orderFulfilmentArabic }
];
