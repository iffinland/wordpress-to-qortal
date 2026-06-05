import { Database, UserPlus, X } from 'lucide-react';
import { useState } from 'react';
import { siteConfig } from '../../config/site';
import { hasQortalBridge, requestQortal } from '../../qdn/qortalClient';

export function FollowButton({ compact = false }: { compact?: boolean }) {
  const params = new URLSearchParams(window.location.search);
  const siteName = params.get('siteName') || siteConfig.siteName;
  const contentName = params.get('contentName') || siteConfig.contentName;
  const archiveNames = [siteName, contentName, ...siteConfig.coauthorNames].filter(Boolean);
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState('');
  const [submitting, setSubmitting] = useState(false);

  async function followNames(names: string[], successMessage: string) {
    setSubmitting(true);
    setMessage('');
    try {
      await requestQortal({
        action: 'ADD_LIST_ITEMS',
        list_name: 'followedNames',
        items: [...new Set(names)]
      });
      setMessage(successMessage);
    } catch (error) {
      setMessage((error as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  function followArchive() {
    return followNames(
      archiveNames,
      `Following ${[...new Set(archiveNames)].join(', ')}. Qortal Core can now mirror the Corbett Report archive.`
    );
  }

  return (
    <>
      <button className={`follow-trigger ${compact ? 'compact' : ''}`} type="button" onClick={() => setOpen(true)}>
        <UserPlus size={15} /> <span>{compact ? 'Follow' : 'Follow'}</span>
      </button>
      {open && (
        <div className="modal-backdrop" role="presentation" onClick={() => setOpen(false)}>
          <section className="follow-modal" role="dialog" aria-modal="true" aria-labelledby="follow-title" onClick={(event) => event.stopPropagation()}>
            <button className="modal-close" type="button" onClick={() => setOpen(false)} title="Close"><X size={18} /></button>
            <p className="eyebrow">Qortal hosting support</p>
            <h2 id="follow-title">Follow The Corbett Report</h2>
            <p>Following helps your local Qortal node mirror published resources and makes the archive easier for peers to retrieve.</p>
            <button className="follow-choice" type="button" onClick={followArchive} disabled={submitting || !hasQortalBridge() || archiveNames.length === 0}>
              <Database size={19} />
              <span><strong>Follow Archive</strong><small>Follow the site, canonical content name, and trusted publisher names used by the CMS.</small></span>
            </button>
            {!hasQortalBridge() && <p className="follow-note">Open this Q-App inside Qortal UI to enable follow controls.</p>}
            {archiveNames.length === 0 && <p className="follow-note">At least one registered Qortal name is required before follow can be enabled.</p>}
            {message && <p className="follow-note" role="status">{message}</p>}
          </section>
        </div>
      )}
    </>
  );
}
