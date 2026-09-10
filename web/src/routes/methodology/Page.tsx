import methodologySource from '../../../../docs/METHODOLOGY.md?raw';
import { DocPage } from '@/components/DocPage';

/**
 * The methodology document is single-sourced from `docs/METHODOLOGY.md` — the same file the
 * repo ships — so the explanation in the UI can never drift from the one in the docs.
 */
export default function MethodologyPage() {
  return (
    <DocPage
      title="Methodology"
      source={methodologySource}
      fallbackLead="How every number in this app is computed, and which of them are estimates."
      sourcePath="docs/METHODOLOGY.md"
    />
  );
}
