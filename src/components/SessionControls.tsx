'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Plug } from 'lucide-react';
import { authApi } from '@/lib/api';
import styles from './SessionControls.module.css';

export function SessionControls({ userName, showMcp = false }: { userName: string; showMcp?: boolean }) {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);

  async function logout() {
    setSubmitting(true);
    try {
      await authApi.logout();
      router.push('/login' as never);
      router.refresh();
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className={styles.controls}>
      <span className={styles.user}>Olá, {userName}</span>
      {showMcp && (
        <Link href="/mcp" className={styles.mcpLink} prefetch={false}>
          <Plug size={14} />
          Conexões MCP
        </Link>
      )}
      <button type="button" onClick={() => void logout()} disabled={submitting}>{submitting ? 'Saindo...' : 'Sair'}</button>
    </div>
  );
}
