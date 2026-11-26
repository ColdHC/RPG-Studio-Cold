'use client';

import { useMemo, useState } from 'react';
import styles from './OAuthConsentForm.module.css';

type Campaign = {
  id: string;
  name: string;
  role: 'OWNER' | 'PLAYER';
  isArchived: boolean;
};

type Props = {
  clientName: string;
  campaigns: Campaign[];
  scopeLabels: Record<string, string>;
  fields: {
    clientId: string;
    redirectUri: string;
    scopes: string[];
    state: string | null;
    codeChallenge: string;
    resource: string;
  };
};

export function OAuthConsentForm({ clientName, campaigns, scopeLabels, fields }: Props) {
  const [selected, setSelected] = useState<string[]>([]);
  const [selectedScopes, setSelectedScopes] = useState<string[]>(fields.scopes);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const availableCampaigns = useMemo(() => campaigns.filter((campaign) => !campaign.isArchived), [campaigns]);

  function toggle(campaignId: string) {
    setSelected((current) =>
      current.includes(campaignId) ? current.filter((id) => id !== campaignId) : [...current, campaignId]
    );
  }

  function toggleScope(scope: string) {
    setSelectedScopes((current) =>
      current.includes(scope) ? current.filter((entry) => entry !== scope) : [...current, scope]
    );
  }

  async function submit(decision: 'approve' | 'deny') {
    setSubmitting(true);
    setError(null);
    try {
      const response = await fetch('/api/oauth/authorize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          client_id: fields.clientId,
          redirect_uri: fields.redirectUri,
          response_type: 'code',
          scope: selectedScopes.join(' '),
          state: fields.state,
          code_challenge: fields.codeChallenge,
          code_challenge_method: 'S256',
          resource: fields.resource,
          decision,
          campaignIds: decision === 'approve' ? selected : []
        })
      });
      const payload = (await response.json().catch(() => ({}))) as { redirectTo?: string; error_description?: string };
      if (!response.ok || !payload.redirectTo) {
        throw new Error(payload.error_description || 'Não foi possível concluir a autorização.');
      }
      window.location.assign(payload.redirectTo);
    } catch (submissionError) {
      setError(submissionError instanceof Error ? submissionError.message : 'Erro inesperado.');
      setSubmitting(false);
    }
  }

  return (
    <div className={styles.form}>
      <div className={styles.section}>
        <h2>Campanhas autorizadas</h2>
        <p className={styles.help}>
          Selecione explicitamente as campanhas que {clientName} poderá consultar. Nenhuma é marcada por padrão.
        </p>
        {availableCampaigns.length === 0 ? (
          <p className={styles.empty}>Você não possui campanhas disponíveis para autorizar.</p>
        ) : (
          <ul className={styles.campaignList}>
            {availableCampaigns.map((campaign) => (
              <li key={campaign.id}>
                <label className={styles.campaign}>
                  <input
                    type="checkbox"
                    checked={selected.includes(campaign.id)}
                    disabled={submitting}
                    onChange={() => toggle(campaign.id)}
                  />
                  <span className={styles.campaignText}>
                    <strong>{campaign.name}</strong>
                    <small>{campaign.role === 'OWNER' ? 'Mestre' : 'Jogador'}</small>
                  </span>
                </label>
              </li>
            ))}
          </ul>
        )}
        {campaigns.some((campaign) => campaign.isArchived) && (
          <p className={styles.help}>Campanhas arquivadas não aparecem nesta lista.</p>
        )}
      </div>

      <div className={styles.section}>
        <h2>Escopos</h2>
        <p className={styles.help}>Você pode reduzir os escopos autorizados antes de continuar.</p>
        <ul className={styles.scopeOptions}>
          {fields.scopes.map((scope) => (
            <li key={scope}>
              <label className={styles.scopeOption}>
                <input
                  type="checkbox"
                  checked={selectedScopes.includes(scope)}
                  disabled={submitting}
                  onChange={() => toggleScope(scope)}
                />
                <span>{scopeLabels[scope] ?? scope}</span>
              </label>
            </li>
          ))}
        </ul>
      </div>

      {error && (
        <div className={styles.error} role="alert">
          {error}
        </div>
      )}

      <div className={styles.actions}>
        <button type="button" className={styles.deny} onClick={() => submit('deny')} disabled={submitting}>
          Cancelar
        </button>
        <button
          type="button"
          className={styles.approve}
          onClick={() => submit('approve')}
          disabled={submitting || selected.length === 0 || selectedScopes.length === 0}
        >
          {submitting ? 'Aguarde...' : 'Autorizar selecionadas'}
        </button>
      </div>
    </div>
  );
}
