// Gallery answer pages (`"kind": "page"`) and books: opened by main.js in a frame over the canvas.
// Each entry: id, name (purpose first), kind (the playground's groups) and data.
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
import checkoutBook from '../../examples/book-checkout-explained.json';
import bookEngineerOnboarding from '../../examples/book-engineer-onboarding.json';
import bookGdprSmallBusiness from '../../examples/book-gdpr-small-business.json';
import bookPostgresRunbook from '../../examples/book-postgres-runbook.json';
import bookHowTheInternetWorks from '../../examples/book-how-the-internet-works.json';

/** One-page answers to a question (explainers, decisions, incident write-ups). */
export const PAGE_EXAMPLES = [
  { id: 'answer-card-payment-journey', name: 'How a card payment reaches the bank', kind: 'page', data: cardPayment },
  { id: 'answer-what-happens-url', name: 'What happens when you type a URL', kind: 'page', data: whatHappensUrl },
  { id: 'answer-safe-feature-rollout', name: 'How to roll out a feature safely', kind: 'page', data: safeRollout },
  { id: 'answer-build-or-buy-crm', name: 'Build or buy a CRM? (decision)', kind: 'page', data: buildOrBuyCrm },
  { id: 'answer-black-friday-slowdown', name: 'Why the site slowed on Black Friday', kind: 'page', data: blackFriday },
  { id: 'answer-checkout-saga', name: 'Why checkout uses a saga (decision)', kind: 'page', data: checkoutSaga },
  { id: 'answer-how-to-choose-database', name: 'How to choose a database', kind: 'page', data: chooseDatabase },
  { id: 'answer-incident-review', name: 'Checkout outage: incident review', kind: 'page', data: incidentReview },
  { id: 'answer-project-kickoff', name: 'Project kickoff: self-service portal', kind: 'page', data: projectKickoff },
  { id: 'answer-explain-photosynthesis', name: 'Photosynthesis, explained (study notes)', kind: 'page', data: photosynthesis },
  { id: 'answer-order-fulfilment-arabic', name: 'Reserve stock first (Arabic, right to left)', kind: 'page', data: orderFulfilmentArabicPage }
];

/** Pages built around charts, plans and metrics. */
export const CHART_EXAMPLES = [
  { id: 'chart-sales-dashboard', name: 'Sales performance dashboard', kind: 'chart', data: salesDashboard },
  { id: 'chart-marketing-analytics', name: 'Website and marketing analytics', kind: 'chart', data: marketingAnalytics },
  { id: 'chart-budget-vs-actual', name: 'Budget against actual', kind: 'chart', data: budgetVsActual },
  { id: 'chart-survey-results', name: 'Customer survey results', kind: 'chart', data: surveyResults },
  { id: 'chart-portfolio-status', name: 'Project portfolio status', kind: 'chart', data: portfolioStatus },
  { id: 'chart-sla-monitoring', name: 'Service levels and incidents', kind: 'chart', data: slaMonitoring },
  { id: 'chart-hr-headcount', name: 'Headcount and hiring', kind: 'chart', data: hrHeadcount },
  { id: 'answer-quarterly-review', name: 'Quarterly business review', kind: 'chart', data: quarterlyReview },
  { id: 'answer-launch-plan', name: 'Launch plan with gantt and risks', kind: 'chart', data: launchPlan }
];

/** Books: answer pages read in order (chapter `$ref`s are inlined at import time). */
export const BOOK_EXAMPLES = [{ id: 'book-checkout-explained', name: 'Checkout, end to end (book)', kind: 'book', data: checkoutBook },
  { id: 'book-engineer-onboarding', name: 'Engineer onboarding (book)', kind: 'book', data: bookEngineerOnboarding },
  { id: 'book-gdpr-small-business', name: 'GDPR for a small clinic (book)', kind: 'book', data: bookGdprSmallBusiness },
  { id: 'book-postgres-runbook', name: 'PostgreSQL runbook (book)', kind: 'book', data: bookPostgresRunbook },
  { id: 'book-how-the-internet-works', name: 'How the internet works (book)', kind: 'book', data: bookHowTheInternetWorks }
];
