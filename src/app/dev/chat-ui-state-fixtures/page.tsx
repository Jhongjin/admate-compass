import fs from "node:fs";
import path from "node:path";
import { notFound } from "next/navigation";
import SourceStatePanel from "@/components/chat/SourceStatePanel";
import type { ChatSource, ChatUiState } from "@/components/chat/chatUiStateTypes";

type ViewportClass = "desktop-lg" | "tablet" | "mobile" | "small-mobile";
type PanelSurface = "right-panel" | "compact-panel";

interface FixtureControl {
  id: string;
  available: boolean;
}

interface ChatUiStateFixture {
  id: string;
  synthetic: boolean;
  routeSurface: string;
  viewportClass: ViewportClass;
  state: ChatUiState;
  promptExpectation?: {
    userPrompt: string;
    promptVisible: boolean;
    resultLinkedToPrompt: boolean;
  };
  message: {
    role: "assistant" | "user";
    content: string;
    noDataFound: boolean;
  };
  sources: ChatSource[];
  expectedControls: FixtureControl[];
  panelExpectation: {
    surface: PanelSurface;
    heading: string;
    sourceCount: number;
  };
}

interface FixturePayload {
  contract?: {
    syntheticOnly?: boolean;
    productionApiCalled?: boolean;
    ragSearchExecuted?: boolean;
    browserUsed?: boolean;
    dbTouched?: boolean;
  };
  fixtures?: ChatUiStateFixture[];
}

const viewportLabels: Record<ViewportClass, string> = {
  "desktop-lg": "1440x900",
  tablet: "768x1024",
  mobile: "390x844",
  "small-mobile": "360x740",
};

const viewportWidths: Record<ViewportClass, string> = {
  "desktop-lg": "min(100%, 1040px)",
  tablet: "min(100%, 768px)",
  mobile: "min(100%, 390px)",
  "small-mobile": "min(100%, 360px)",
};

function readFixturePayload(): FixturePayload {
  const fixturePath = path.join(process.cwd(), "docs", "rag", "compass-chat-ui-state-contract-fixtures.json");
  return JSON.parse(fs.readFileSync(fixturePath, "utf8")) as FixturePayload;
}

function hasAvailableControl(fixture: ChatUiStateFixture, controlId: string) {
  return fixture.expectedControls.some((control) => control.id === controlId && control.available);
}

function getValidatedFixtures() {
  const payload = readFixturePayload();
  const contract = payload.contract;
  const contractIsSafe = Boolean(contract?.syntheticOnly)
    && contract?.productionApiCalled === false
    && contract?.ragSearchExecuted === false
    && contract?.browserUsed === false
    && contract?.dbTouched === false;

  if (!contractIsSafe || !Array.isArray(payload.fixtures)) {
    return [];
  }

  return payload.fixtures.filter((fixture) => fixture.synthetic && fixture.routeSurface === "desk");
}

function FixtureTranscript({ fixture }: { fixture: ChatUiStateFixture }) {
  return (
    <div className="space-y-3">
      {fixture.promptExpectation?.userPrompt && (
        <div className="ml-auto max-w-[88%] rounded-lg bg-[#0D0D0D] px-4 py-3 text-sm leading-6 text-white">
          {fixture.promptExpectation.userPrompt}
        </div>
      )}
      <div className="max-w-[92%] rounded-lg border border-[#E5E5E5] bg-white px-4 py-3 text-sm leading-6 text-[#0D0D0D] shadow-sm">
        {fixture.message.content}
      </div>
    </div>
  );
}

function FixturePanel({ fixture, compact }: { fixture: ChatUiStateFixture; compact: boolean }) {
  return (
    <SourceStatePanel
      state={fixture.state}
      sources={fixture.sources}
      compact={compact}
      userQuestion={fixture.promptExpectation?.userPrompt}
      showContactOption={hasAvailableControl(fixture, "contact-support")}
      sourceOpenMode="noop"
    />
  );
}

export default function ChatUiStateFixturesPage() {
  if (process.env.NODE_ENV !== "development") {
    notFound();
  }

  const fixtures = getValidatedFixtures();
  if (fixtures.length === 0) {
    notFound();
  }

  return (
    <main className="min-h-screen bg-[#F7F7F7] px-4 py-6 text-[#0D0D0D] sm:px-6">
      <div className="mx-auto max-w-7xl space-y-5">
        <header className="border-b border-[#E5E5E5] pb-4">
          <h1 className="text-xl font-semibold">Compass chat UI state fixtures</h1>
          <p className="mt-1 text-sm text-[#5E5E5E]">
            Local renderer for committed synthetic fixtures. No login, prompt input, API calls, RAG search, or database access.
          </p>
        </header>

        <div className="space-y-6">
          {fixtures.map((fixture) => {
            const surface = fixture.panelExpectation.surface;
            const compact = surface === "compact-panel";

            return (
              <section key={fixture.id} className="border-b border-[#E5E5E5] pb-6">
                <div className="mb-3 flex flex-wrap items-center gap-2 text-xs text-[#5E5E5E]">
                  <span className="rounded-md border border-[#D8DAF4] bg-[#F4F5FF] px-2 py-1 text-[#4F56B8]">{fixture.id}</span>
                  <span className="rounded-md border border-[#E5E5E5] bg-white px-2 py-1">{fixture.state}</span>
                  <span className="rounded-md border border-[#E5E5E5] bg-white px-2 py-1">
                    {fixture.viewportClass} {viewportLabels[fixture.viewportClass]}
                  </span>
                  <span className="rounded-md border border-[#E5E5E5] bg-white px-2 py-1">{surface}</span>
                </div>

                <div className="mx-auto overflow-hidden rounded-lg border border-[#E5E5E5] bg-[#F7F7F7]" style={{ width: viewportWidths[fixture.viewportClass] }}>
                  <div className="border-b border-[#E5E5E5] bg-white px-4 py-3">
                    <div className="text-sm font-semibold">AdMate Compass 정책 검색</div>
                    <div className="text-xs text-[#5E5E5E]">Fixture viewport: {viewportLabels[fixture.viewportClass]}</div>
                  </div>

                  {compact ? (
                    <div className="space-y-4 p-3">
                      <FixtureTranscript fixture={fixture} />
                      <FixturePanel fixture={fixture} compact />
                      <div className="border-t border-[#E5E5E5] bg-white p-3">
                        <div className="h-10 rounded-md border border-[#D4D4D4] bg-white" />
                      </div>
                    </div>
                  ) : (
                    <div className="grid gap-0 lg:grid-cols-[minmax(0,1fr)_minmax(18rem,24rem)]">
                      <div className="min-w-0 space-y-4 border-r border-[#E5E5E5] p-4">
                        <FixtureTranscript fixture={fixture} />
                      </div>
                      <aside className="min-w-0 bg-white p-4">
                        <FixturePanel fixture={fixture} compact={false} />
                      </aside>
                    </div>
                  )}
                </div>
              </section>
            );
          })}
        </div>
      </div>
    </main>
  );
}
