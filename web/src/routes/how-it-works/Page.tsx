import howItWorksSource from '../../../../docs/HOW-IT-WORKS.md?raw';
import { DocPage } from '@/components/DocPage';

/**
 * The answer to "where does this data come from, and what do I have to run?", single-sourced
 * from `docs/HOW-IT-WORKS.md` the same way the methodology page is. Methodology explains how a
 * number is computed; this page explains when it is computed and by what.
 */
export default function HowItWorksPage() {
  return (
    <DocPage
      title="How it works"
      source={howItWorksSource}
      fallbackLead="Where the data comes from, when the index updates, and what is automatic."
      sourcePath="docs/HOW-IT-WORKS.md"
    />
  );
}
