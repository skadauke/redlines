import { AiDocsSection } from '../../components/ai-docs-section';
import { ChangesSection } from '../../components/changes-section';
import { ClosingSection } from '../../components/closing-section';
import { CompareSection } from '../../components/compare-section';
import { DownloadSection } from '../../components/download-section';
import { EditorSection } from '../../components/editor-section';
import { Footer } from '../../components/footer';
import { Header } from '../../components/header';
import { Hero } from '../../components/hero';
import { TeamsSection } from '../../components/teams-section';

export default function Home() {
  return (
    <div className="wrap">
      <Header />
      <main id="main">
        <Hero />
        <EditorSection />
        <AiDocsSection />
        <ChangesSection />
        <CompareSection />
        <TeamsSection />
        <ClosingSection />
        <DownloadSection />
      </main>
      <Footer />
    </div>
  );
}
