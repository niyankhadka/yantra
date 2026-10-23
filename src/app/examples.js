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
import cardPayment3ds from '../../examples/card-payment-3ds.json';
import webhookDeliveryRetries from '../../examples/webhook-delivery-retries.json';
import passwordResetEmail from '../../examples/password-reset-email.json';
import presignedUpload from '../../examples/presigned-upload.json';
import onlineOrderLifecycle from '../../examples/online-order-lifecycle.json';
import mortgageApplicationStates from '../../examples/mortgage-application-states.json';
import pullRequestLifecycle from '../../examples/pull-request-lifecycle.json';
import hospitalAppointmentsSchema from '../../examples/hospital-appointments-schema.json';
import libraryLendingSchema from '../../examples/library-lending-schema.json';
import saasBillingSchema from '../../examples/saas-billing-schema.json';
import schoolTimetableSchema from '../../examples/school-timetable-schema.json';
import notificationClasses from '../../examples/notification-classes.json';
import inventoryClasses from '../../examples/inventory-classes.json';
import rideHailingClasses from '../../examples/ride-hailing-classes.json';
import bankAccountEventSourcing from '../../examples/bank-account-event-sourcing.json';
import hospitalClinicalDirectorates from '../../examples/hospital-clinical-directorates.json';
import universityFacultyDepartments from '../../examples/university-faculty-departments.json';
import cityCouncilServices from '../../examples/city-council-services.json';
import scaleupEngineeringOrg from '../../examples/scaleup-engineering-org.json';
import databaseChoiceDecisionTree from '../../examples/database-choice-decision-tree.json';
import gdprBreachReportingDecisionTree from '../../examples/gdpr-breach-reporting-decision-tree.json';
import returnsRefundsDecisionTree from '../../examples/returns-refunds-decision-tree.json';
import cloudHostingDecisionTree from '../../examples/cloud-hosting-decision-tree.json';
import productLaunchMindmap from '../../examples/product-launch-mindmap.json';
import newManager90DaysMindmap from '../../examples/new-manager-90-days-mindmap.json';
import websiteRedesignResearchMindmap from '../../examples/website-redesign-research-mindmap.json';
import householdBudgetMindmap from '../../examples/household-budget-mindmap.json';
import airlineAirportOperations from '../../examples/airline-airport-operations.json';
import libraryLendingSpanish from '../../examples/library-lending-spanish.json';
import restaurantOrdersJapanese from '../../examples/restaurant-orders-japanese.json';
import clinicBookingHebrew from '../../examples/clinic-booking-hebrew.json';
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
  { id: 'payment-classes', name: 'Checkout classes (UML)', kind: 'class', data: paymentClasses },
  { id: 'platform-overview', name: 'Shop platform: overview with detail diagrams', kind: 'drill', data: platform },
  { id: 'smart-city-operations', name: 'Smart city sensors, six levels deep', kind: 'drill', data: smartCity },
  { id: 'global-retail-group', name: 'Retail group: boardroom to till (drill-down)', kind: 'drill', data: retailGroup },
  { id: 'hospital-trust-monitoring', name: 'Hospital trust: from the trust to one bed', kind: 'drill', data: hospitalTrust },
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
  { id: 'incident-triage-decision-tree', name: 'Incident severity decision tree', kind: 'decision', data: triageTree },
  { id: 'health-referral-nepali', name: 'Patient referral, village to hospital (Nepali)', kind: 'lang', data: healthReferralNepali },
  { id: 'order-fulfilment-arabic', name: 'Order fulfilment (Arabic, right to left)', kind: 'lang', data: orderFulfilmentArabic },
  { id: 'card-payment-3ds', name: 'Card payment with 3-D Secure', kind: 'sequence', data: cardPayment3ds },
  { id: 'webhook-delivery-retries', name: 'Webhook delivery with retries', kind: 'sequence', data: webhookDeliveryRetries },
  { id: 'password-reset-email', name: 'Password reset by email link', kind: 'sequence', data: passwordResetEmail },
  { id: 'presigned-upload', name: 'File upload with a presigned URL', kind: 'sequence', data: presignedUpload },
  { id: 'online-order-lifecycle', name: 'Online order lifecycle', kind: 'state', data: onlineOrderLifecycle },
  { id: 'mortgage-application-states', name: 'Mortgage application states', kind: 'state', data: mortgageApplicationStates },
  { id: 'pull-request-lifecycle', name: 'Pull request lifecycle', kind: 'state', data: pullRequestLifecycle },
  { id: 'hospital-appointments-schema', name: 'Hospital appointments database (ER)', kind: 'data', data: hospitalAppointmentsSchema },
  { id: 'library-lending-schema', name: 'Library lending database (ER)', kind: 'data', data: libraryLendingSchema },
  { id: 'saas-billing-schema', name: 'SaaS billing database (ER)', kind: 'data', data: saasBillingSchema },
  { id: 'school-timetable-schema', name: 'School timetable database (ER)', kind: 'data', data: schoolTimetableSchema },
  { id: 'notification-classes', name: 'Notification service classes (UML)', kind: 'class', data: notificationClasses },
  { id: 'inventory-classes', name: 'Warehouse inventory classes (UML)', kind: 'class', data: inventoryClasses },
  { id: 'ride-hailing-classes', name: 'Ride-hailing booking classes (UML)', kind: 'class', data: rideHailingClasses },
  { id: 'bank-account-event-sourcing', name: 'Event-sourced bank account (UML)', kind: 'class', data: bankAccountEventSourcing },
  { id: 'hospital-clinical-directorates', name: 'Hospital directorates', kind: 'tree', data: hospitalClinicalDirectorates },
  { id: 'university-faculty-departments', name: 'University faculty', kind: 'tree', data: universityFacultyDepartments },
  { id: 'city-council-services', name: 'City council services', kind: 'tree', data: cityCouncilServices },
  { id: 'scaleup-engineering-org', name: 'Engineering organisation', kind: 'tree', data: scaleupEngineeringOrg },
  { id: 'database-choice-decision-tree', name: 'Choosing a database', kind: 'decision', data: databaseChoiceDecisionTree },
  { id: 'gdpr-breach-reporting-decision-tree', name: 'Data breach reporting', kind: 'decision', data: gdprBreachReportingDecisionTree },
  { id: 'returns-refunds-decision-tree', name: 'Returns and refunds', kind: 'decision', data: returnsRefundsDecisionTree },
  { id: 'cloud-hosting-decision-tree', name: 'Cloud hosting choice', kind: 'decision', data: cloudHostingDecisionTree },
  { id: 'product-launch-mindmap', name: 'Smart thermostat launch plan', kind: 'mindmap', data: productLaunchMindmap },
  { id: 'new-manager-90-days-mindmap', name: 'A new manager\'s first 90 days', kind: 'mindmap', data: newManager90DaysMindmap },
  { id: 'website-redesign-research-mindmap', name: 'Council website redesign research', kind: 'mindmap', data: websiteRedesignResearchMindmap },
  { id: 'household-budget-mindmap', name: 'Monthly household budget', kind: 'mindmap', data: householdBudgetMindmap },
  { id: 'airline-airport-operations', name: 'Airline operations at the airport (drill-down)', kind: 'drill', data: airlineAirportOperations },
  { id: 'library-lending-spanish', name: 'Library book lending (Spanish)', kind: 'lang', data: libraryLendingSpanish },
  { id: 'restaurant-orders-japanese', name: 'Restaurant order to kitchen (Japanese)', kind: 'lang', data: restaurantOrdersJapanese },
  { id: 'clinic-booking-hebrew', name: 'Clinic appointment booking (Hebrew)', kind: 'lang', data: clinicBookingHebrew }
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
  ['class', 'play.kind.class'],
  ['tree', 'play.kind.tree'],
  ['decision', 'play.kind.decision'],
  ['mindmap', 'play.kind.mindmap'],
  ['drill', 'play.kind.drill'],
  ['lang', 'play.kind.lang'],
  ['page', 'play.kind.page'],
  ['chart', 'play.kind.chart'],
  ['book', 'play.kind.book']
];
