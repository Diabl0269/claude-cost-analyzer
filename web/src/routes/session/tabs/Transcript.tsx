import { useSessionContext } from '../context';
import { TranscriptView } from '../transcript/TranscriptView';

export default function TranscriptTab() {
  const { id, detail, whatIf } = useSessionContext();
  return (
    <TranscriptView
      key={`${id}:main:${whatIf.param ?? ''}`}
      sessionId={id}
      agentId={null}
      detail={detail}
      whatIf={whatIf.param}
    />
  );
}
