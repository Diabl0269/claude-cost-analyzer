import { EmptyState } from '@/components/EmptyState';
import { LinkButton } from '@/components/Button';

export default function NotFoundPage() {
  return (
    <div className="stack">
      <h1>Page not found</h1>
      <EmptyState
        title="No such page"
        icon="search"
        description="The URL does not match any view in this app."
        action={<LinkButton to="/" variant="secondary">Back to overview</LinkButton>}
      />
    </div>
  );
}
