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
import platform from '../../examples/platform-overview.json';

/** Built-in gallery, shown only when the page has no embedded payload. */
export const EXAMPLES = [
  { id: 'cloud-architecture', name: 'Cloud architecture', data: cloud },
  { id: 'aws-serverless', name: 'AWS serverless (groups)', data: awsServerless },
  { id: 'oauth-login', name: 'OAuth sign-in (sequence)', data: oauthLogin },
  { id: 'platform-overview', name: 'Shop platform (drill-down)', data: platform },
  { id: 'sales-pipeline', name: 'B2B sales pipeline', data: sales },
  { id: 'supply-chain', name: 'Supply chain', data: supplyChain },
  { id: 'academic-faculty', name: 'Academic lifecycle', data: academic },
  { id: 'healthcare-clinical', name: 'Emergency care pathway', data: healthcare },
  { id: 'ml-training-pipeline', name: 'ML training pipeline (groups)', data: mlPipeline },
  { id: 'customer-support-escalation', name: 'Support escalation (modes)', data: supportEscalation },
  { id: 'manufacturing-quality', name: 'Manufacturing quality (panel)', data: manufacturing },
  { id: 'research-paper-lifecycle', name: 'Research paper lifecycle', data: researchPaper }
];
