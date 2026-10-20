// Gallery answer pages (`"kind": "page"`): opened by main.js in a frame over the canvas.
// Diagram blocks' `src` files are inlined at import time (vite.config.js drillRefs).
import cardPayment from '../../examples/answer-card-payment-journey.json';
import whatHappensUrl from '../../examples/answer-what-happens-url.json';
import safeRollout from '../../examples/answer-safe-feature-rollout.json';
import buildOrBuyCrm from '../../examples/answer-build-or-buy-crm.json';
import blackFriday from '../../examples/answer-black-friday-slowdown.json';
import checkoutSaga from '../../examples/answer-checkout-saga.json';
import chooseDatabase from '../../examples/answer-how-to-choose-database.json';
import incidentReview from '../../examples/answer-incident-review.json';
import projectKickoff from '../../examples/answer-project-kickoff.json';
import photosynthesis from '../../examples/answer-explain-photosynthesis.json';
import orderFulfilmentArabicPage from '../../examples/answer-order-fulfilment-arabic.json';
import quarterlyReview from '../../examples/answer-quarterly-review.json';
import launchPlan from '../../examples/answer-launch-plan.json';
import salesDashboard from '../../examples/chart-sales-dashboard.json';
import marketingAnalytics from '../../examples/chart-marketing-analytics.json';
import budgetVsActual from '../../examples/chart-budget-vs-actual.json';
import surveyResults from '../../examples/chart-survey-results.json';
import portfolioStatus from '../../examples/chart-portfolio-status.json';
import slaMonitoring from '../../examples/chart-sla-monitoring.json';
import hrHeadcount from '../../examples/chart-hr-headcount.json';

/** One-page answers to a question (explainers, decisions, incident write-ups). */
export const PAGE_EXAMPLES = [
  { id: 'answer-card-payment-journey', name: 'Card tap to merchant bank (explainer)', data: cardPayment },
  { id: 'answer-what-happens-url', name: 'Typing a URL into a browser (explainer)', data: whatHappensUrl },
  { id: 'answer-safe-feature-rollout', name: 'Rolling out a feature safely (how-to)', data: safeRollout },
  { id: 'answer-build-or-buy-crm', name: 'Build or buy a CRM (decision)', data: buildOrBuyCrm },
  { id: 'answer-black-friday-slowdown', name: 'Black Friday slowdown (incident)', data: blackFriday },
  { id: 'answer-checkout-saga', name: 'Checkout saga (architecture decision)', data: checkoutSaga },
  { id: 'answer-how-to-choose-database', name: 'Choosing a database (decision)', data: chooseDatabase },
  { id: 'answer-incident-review', name: 'Checkout outage (incident review)', data: incidentReview },
  { id: 'answer-project-kickoff', name: 'Self-service portal (kickoff)', data: projectKickoff },
  { id: 'answer-explain-photosynthesis', name: 'Photosynthesis (study notes)', data: photosynthesis },
  { id: 'answer-order-fulfilment-arabic', name: 'Reserve stock first (Arabic, RTL)', data: orderFulfilmentArabicPage }
];

/** Pages built around charts, plans and metrics. */
export const CHART_EXAMPLES = [
  { id: 'chart-sales-dashboard', name: 'Sales performance dashboard', data: salesDashboard },
  { id: 'chart-marketing-analytics', name: 'Website and marketing analytics', data: marketingAnalytics },
  { id: 'chart-budget-vs-actual', name: 'Budget against actual', data: budgetVsActual },
  { id: 'chart-survey-results', name: 'Customer survey results', data: surveyResults },
  { id: 'chart-portfolio-status', name: 'Project portfolio status', data: portfolioStatus },
  { id: 'chart-sla-monitoring', name: 'Service levels and incidents', data: slaMonitoring },
  { id: 'chart-hr-headcount', name: 'Headcount and hiring', data: hrHeadcount },
  { id: 'answer-quarterly-review', name: 'Quarterly business review', data: quarterlyReview },
  { id: 'answer-launch-plan', name: 'Launch plan (gantt, risks)', data: launchPlan }
];
