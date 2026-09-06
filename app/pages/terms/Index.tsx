import { Link } from "react-router-dom";
import { getPageMeta } from "@/utils/seo";
import { renderSEOTags } from "@/utils/seo-tags";
import { generatePageTitle } from "@/utils/utils";

export default function TermsIndex() {
  const pageMeta = getPageMeta();
  const pageTitle = generatePageTitle("Terms of Use");

  return (
    <>
      {renderSEOTags(pageMeta, pageTitle)}
      <div className="w-full min-h-[calc(100vh-64px)] flex justify-center py-8 px-4 sm:px-6 lg:px-8 bg-[#131519] text-[#f4f7f9]">
        <article className="max-w-4xl w-full bg-[#1d1a26] border border-white/10 rounded-2xl p-6 sm:p-10 shadow-2xl space-y-8">
          {/* Header */}
          <header className="border-b border-white/10 pb-6">
            <div className="flex flex-wrap items-center justify-between gap-4 mb-4">
              <span className="inline-flex items-center px-3 py-1 rounded-full text-xs font-medium bg-[#557cff]/10 text-[#557cff] border border-[#557cff]/20">
                Official Policy
              </span>
              <span className="text-xs text-neutral-400 bg-white/5 px-3 py-1 rounded-md">
                Last Updated: September 6, 2026
              </span>
            </div>
            <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-white">
              ROTA.FINANCE TERMS OF USE
            </h1>
            <p className="mt-4 text-sm sm:text-base text-neutral-300 leading-relaxed">
              These Terms of Use (&quot;Agreement&quot;) govern your access to
              and use of the website, decentralized exchange (DEX) interface,
              smart contracts, and related services provided by Rota.finance
              (&quot;Platform&quot;, &quot;we&quot;, &quot;us&quot;, or
              &quot;our&quot;). By accessing the Platform or connecting your
              wallet, you agree to all the terms and conditions set forth in
              this Agreement.
            </p>
          </header>

          {/* Section 1 */}
          <section className="space-y-3">
            <h2 className="text-lg sm:text-xl font-bold text-white border-l-4 border-[#557cff] pl-3">
              1. Nature of Services and Decentralized Infrastructure
            </h2>
            <div className="space-y-2 text-sm sm:text-base text-neutral-300 leading-relaxed">
              <p>
                <strong className="text-white font-semibold">
                  1.1. Non-Custodial Infrastructure:
                </strong>{" "}
                Rota.finance is a non-custodial platform where users maintain
                full control of their own crypto assets. The Platform does not
                hold, manage, or directly control the transfer of your assets.
              </p>
              <p>
                <strong className="text-white font-semibold">
                  1.2. Smart Contracts:
                </strong>{" "}
                Transactions are executed via independent smart contracts
                running on the blockchain. By the nature of smart contracts,
                transactions are irreversible.
              </p>
            </div>
          </section>

          {/* Section 2 */}
          <section className="space-y-3">
            <h2 className="text-lg sm:text-xl font-bold text-white border-l-4 border-[#557cff] pl-3">
              2. AlgoBotApp Integration and Managed Services
            </h2>
            <div className="space-y-2 text-sm sm:text-base text-neutral-300 leading-relaxed">
              <p>
                <strong className="text-white font-semibold">
                  2.1. Strategic Partnership:
                </strong>{" "}
                Rota.finance operates under the same umbrella as, and is fully
                integrated with,{" "}
                <a
                  href="https://algobotapp.com/"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-[#557cff] hover:underline font-medium"
                >
                  algobotapp.com
                </a>{" "}
                as a joint company and strategic partner in the fields of
                algorithmic trading and bot management.
              </p>
              <p>
                <strong className="text-white font-semibold">
                  2.2. Algorithmic Trading:
                </strong>{" "}
                The algorithmic trading tools, automated trading bots, and
                managed services provided on the Platform are directly supported
                by the AlgoBotApp infrastructure. Users acknowledge that when
                using these tools on Rota.finance, they are utilizing the
                signal, routing, and bot logic services provided by AlgoBotApp
                without hesitation.
              </p>
              <p>
                <strong className="text-white font-semibold">
                  2.3. Shared Responsibility:
                </strong>{" "}
                Automated transactions triggered via the Rota.finance interface
                based on AlgoBotApp rely on parameters set or approved by the
                user. Any profits or losses arising from how these algorithms
                react to market conditions are solely the responsibility of the
                user.
              </p>
            </div>
          </section>

          {/* Section 3 */}
          <section className="space-y-3">
            <h2 className="text-lg sm:text-xl font-bold text-white border-l-4 border-[#557cff] pl-3">
              3. User Obligations and Security
            </h2>
            <div className="space-y-2 text-sm sm:text-base text-neutral-300 leading-relaxed">
              <p>
                <strong className="text-white font-semibold">
                  3.1. Wallet Security:
                </strong>{" "}
                You are solely responsible for the security of your private
                keys, login credentials (Privy, email, social media approvals,
                etc.), and wallet access. Rota.finance cannot restore your
                access or recover stolen funds due to lost keys or compromised
                accounts.
              </p>
              <p>
                <strong className="text-white font-semibold">
                  3.2. Legal Compliance:
                </strong>{" "}
                You are obligated to use the Platform in compliance with the
                local laws of your applicable jurisdiction.
              </p>
              <p>
                <strong className="text-white font-semibold">
                  3.3. Restricted Jurisdictions:
                </strong>{" "}
                The Platform does not provide services to citizens of the United
                States (US), residents of the US, or individuals in
                countries/regions subject to international sanctions (e.g.,
                countries on the OFAC sanctions list). Bypassing these
                restrictions using IP masking methods (such as VPNs) constitutes
                a material breach of this Agreement.
              </p>
            </div>
          </section>

          {/* Section 4 */}
          <section className="space-y-3">
            <h2 className="text-lg sm:text-xl font-bold text-white border-l-4 border-[#557cff] pl-3">
              4. Assumption of Risk
            </h2>
            <div className="text-sm sm:text-base text-neutral-300 leading-relaxed space-y-2">
              <p>
                By using the Platform, you declare that you understand and
                accept the following fundamental risks:
              </p>
              <ul className="list-disc list-inside space-y-2 pl-2">
                <li>
                  <strong className="text-white font-semibold">
                    Market Risk:
                  </strong>{" "}
                  Crypto asset markets are highly volatile. There is a
                  substantial risk that the value of your investments may drop
                  to zero.
                </li>
                <li>
                  <strong className="text-white font-semibold">
                    Technology Risk:
                  </strong>{" "}
                  Delays in blockchain networks, network congestion, node
                  failures, or outages in third-party authentication providers
                  like Privy may affect your transactions.
                </li>
                <li>
                  <strong className="text-white font-semibold">
                    Cybersecurity Risk:
                  </strong>{" "}
                  Smart contracts, open-source software, and Web3 protocols
                  inherently carry the risk of cyber attacks, exploits, and
                  coding bugs.
                </li>
                <li>
                  <strong className="text-white font-semibold">
                    Algorithm Risk:
                  </strong>{" "}
                  Grid strategies, bots, and signal triggers provided via
                  AlgoBotApp may be based on past performance; past performance
                  is not a guarantee of future results.
                </li>
              </ul>
            </div>
          </section>

          {/* Section 5 */}
          <section className="space-y-3">
            <h2 className="text-lg sm:text-xl font-bold text-white border-l-4 border-[#557cff] pl-3">
              5. Limitation of Liability
            </h2>
            <p className="text-sm sm:text-base text-neutral-300 leading-relaxed">
              To the maximum extent permitted by applicable law; Rota.finance,{" "}
              <a
                href="https://algobotapp.com/"
                target="_blank"
                rel="noopener noreferrer"
                className="text-[#557cff] hover:underline font-medium"
              >
                algobotapp.com
              </a>
              , their developers, founders, and partners shall not be held
              liable for any direct, indirect, incidental, or punitive damages
              (including, but not limited to, loss of profits, loss of data, or
              loss of assets) arising from the use of the Platform, smart
              contract bugs, algorithmic trading results, or failures in
              third-party wallet/login integrations. The Platform is provided
              strictly on an &quot;AS IS&quot; and &quot;AS AVAILABLE&quot;
              basis.
            </p>
          </section>

          {/* Section 6 */}
          <section className="space-y-3">
            <h2 className="text-lg sm:text-xl font-bold text-white border-l-4 border-[#557cff] pl-3">
              6. Intellectual Property
            </h2>
            <p className="text-sm sm:text-base text-neutral-300 leading-relaxed">
              All intellectual property rights for the trademarks, logos,
              software codes, interface designs, and provided algorithms (unless
              specifically licensed as open-source) belonging to Rota.finance
              and AlgoBotApp are strictly reserved.
            </p>
          </section>

          {/* Section 7 */}
          <section className="space-y-3">
            <h2 className="text-lg sm:text-xl font-bold text-white border-l-4 border-[#557cff] pl-3">
              7. Tax Obligations
            </h2>
            <p className="text-sm sm:text-base text-neutral-300 leading-relaxed">
              All tax declaration and payment obligations in your jurisdiction
              regarding the earnings you generate on the Platform are
              exclusively your responsibility. Rota.finance does not withhold
              taxes on behalf of any user.
            </p>
          </section>

          {/* Section 8 */}
          <section className="space-y-3">
            <h2 className="text-lg sm:text-xl font-bold text-white border-l-4 border-[#557cff] pl-3">
              8. Amendments to the Agreement
            </h2>
            <p className="text-sm sm:text-base text-neutral-300 leading-relaxed">
              Rota.finance reserves the right to unilaterally update or modify
              these Terms of Use at any time without prior notice. Updates
              become effective immediately upon revising the &quot;Last
              Updated&quot; date at the top of this page. Your continued use of
              the Platform constitutes your acceptance of the revised terms.
            </p>
          </section>

          {/* Action Footer */}
          <div className="pt-6 border-t border-white/10 flex flex-wrap items-center justify-between gap-4">
            <span className="text-xs text-neutral-400">
              © 2026 ROTA Finance. All rights reserved.
            </span>
            <Link
              to="/perp"
              className="inline-flex items-center px-4 py-2 rounded-lg text-sm font-semibold bg-[#557cff] hover:bg-[#7394ff] text-white transition-colors duration-200"
            >
              Back to Trading
            </Link>
          </div>
        </article>
      </div>
    </>
  );
}
