import { isMcpEnabled } from '@/lib/mcp/config';
import { ConfiguracoesClient } from './ConfiguracoesClient';

export const dynamic = 'force-dynamic';

export default function ConfiguracoesPage() {
  return <ConfiguracoesClient showMcp={isMcpEnabled()} />;
}
