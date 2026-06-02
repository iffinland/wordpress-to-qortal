import { CreditCard, MessageSquare, User } from 'lucide-react';

export function MemberDashboardPage() {
  return (
    <section className="reserved-page">
      <p className="eyebrow">Reserved application area</p>
      <h1>Member Dashboard</h1>
      <p>This route is separated from the public frontend so Qortal wallet-based membership can be implemented without coupling payment logic to the archive renderer.</p>
      <div className="reserved-grid">
        <div><User /><strong>Account profile</strong><span>Qortal identity and membership state</span></div>
        <div><CreditCard /><strong>QORT membership</strong><span>Plans, payments and expiry history</span></div>
        <div><MessageSquare /><strong>Comments</strong><span>Member-authored QDN comment activity</span></div>
      </div>
    </section>
  );
}
