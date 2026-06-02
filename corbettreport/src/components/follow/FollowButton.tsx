import { Database, HardDrive, UserPlus, X } from 'lucide-react';
import { useState } from 'react';
import { siteConfig } from '../../config/site';
import { hasQortalBridge, requestQortal } from '../../qdn/qortalClient';

export function FollowButton() {
  const params = new URLSearchParams(window.location.search);
  const siteName = params.get('siteName') || siteConfig.siteName;
  const contentName = params.get('contentName') || siteConfig.contentName;
  const mediaName = siteConfig.mediaName;
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

  function followEssential() {
    return followNames(
      [siteName, contentName],
      `Following ${siteName} and ${contentName}. Qortal Core can now mirror the essential archive.`
    );
  }

  function followFullArchive() {
    return followNames(
      [siteName, contentName, mediaName],
      `Following ${siteName}, ${contentName} and ${mediaName}. Qortal Core can now mirror the full archive.`
    );
  }

  return (
    <>
      <button className="follow-trigger" type="button" onClick={() => setOpen(true)}>
        <UserPlus size={15} /> Follow
      </button>
      {open && (
        <div className="modal-backdrop" role="presentation" onClick={() => setOpen(false)}>
          <section className="follow-modal" role="dialog" aria-modal="true" aria-labelledby="follow-title" onClick={(event) => event.stopPropagation()}>
            <button className="modal-close" type="button" onClick={() => setOpen(false)} title="Close"><X size={18} /></button>
            <p className="eyebrow">Qortal hosting support</p>
            <h2 id="follow-title">Follow The Corbett Report</h2>
            <p>Following helps your local Qortal node mirror published resources and makes the archive easier for peers to retrieve.</p>
            <button className="follow-choice" type="button" onClick={followEssential} disabled={submitting || !hasQortalBridge() || !siteName || !contentName}>
              <Database size={19} />
              <span><strong>Follow Essential</strong><small>Website and CMS by {siteName || 'the configured site publisher'}; text, images and documents by {contentName || 'the configured content publisher'}</small></span>
            </button>
            <button className="follow-choice" type="button" onClick={followFullArchive} disabled={submitting || !hasQortalBridge() || !siteName || !contentName || !mediaName}>
              <HardDrive size={19} />
              <span><strong>Follow Full Archive</strong><small>Add audio and video published by {mediaName || 'the configured media publisher'}</small></span>
            </button>
            {!hasQortalBridge() && <p className="follow-note">Open this Q-App inside Qortal UI to enable follow controls.</p>}
            {(!siteName || !contentName) && <p className="follow-note">Registered site and content Qortal names are required before follow can be enabled.</p>}
            {message && <p className="follow-note" role="status">{message}</p>}
          </section>
        </div>
      )}
    </>
  );
}
