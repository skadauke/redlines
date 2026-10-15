import { AiDocsSection } from '../../components/ai-docs-section';
import { ChangesSection } from '../../components/changes-section';
import { ClosingSection } from '../../components/closing-section';
import { CompareSection } from '../../components/compare-section';
import { DevelopersSection } from '../../components/developers-section';
import { DownloadSection } from '../../components/download-section';
import { Footer } from '../../components/footer';
import { Header } from '../../components/header';
import { Hero } from '../../components/hero';
import { UsesSection } from '../../components/uses-section';

export default function Home() {
  return (
    <div className="wrap">
      <Header />
      <main id="main">
        <Hero />
        <AiDocsSection />
        <ChangesSection />
        <CompareSection />
        <UsesSection />
        <DevelopersSection />
        <ClosingSection />
        <DownloadSection />
      </main>
      <Footer />
    </div>
  );
}
