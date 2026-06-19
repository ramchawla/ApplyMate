import { useEffect, useState } from "react";
import ReactDOM from "react-dom/client";
import "./styles/tailwind.css";
import { JobDataReview } from "./components/JobDataReview";
import { FormValidation } from "./components/FormValidation";
import { SidePanelState } from "../types";
import { getExtractedJobData } from "../utils/storage";

function App() {
  const [state, setState] = useState<SidePanelState>({
    extractedJobData: undefined,
    currentTab: "data-review",
    isLoading: true,
  });

  useEffect(() => {
    void loadExtractedData();
    const interval = setInterval(() => void loadExtractedData(), 1000);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function loadExtractedData() {
    const data = await getExtractedJobData();
    setState((prev) => {
      if (data && data.id !== prev.extractedJobData?.id) {
        return { ...prev, extractedJobData: data, isLoading: false };
      }
      if (prev.isLoading) {
        return { ...prev, isLoading: false };
      }
      return prev;
    });
  }

  if (state.isLoading) {
    return <div className="p-4">Loading…</div>;
  }

  if (!state.extractedJobData) {
    return (
      <div className="p-4">
        <p>
          No job data detected. Visit a job posting and click the ApplyMate
          button.
        </p>
      </div>
    );
  }

  return (
    <div className="w-80 max-h-screen overflow-y-auto bg-white">
      {state.currentTab === "data-review" && (
        <JobDataReview
          data={state.extractedJobData}
          onNext={() =>
            setState((prev) => ({ ...prev, currentTab: "form-validation" }))
          }
        />
      )}

      {state.currentTab === "form-validation" && (
        <FormValidation
          fields={state.extractedJobData.formFields}
          onProceed={() =>
            setState((prev) => ({ ...prev, currentTab: "tailoring-review" }))
          }
        />
      )}
      {state.currentTab === "tailoring-review" && (
        <div className="p-4">Tailoring Review (Phase 2)</div>
      )}
      {state.currentTab === "form-auto-fill" && (
        <div className="p-4">Form Auto-Fill (Phase 3)</div>
      )}
    </div>
  );
}

ReactDOM.createRoot(
  document.getElementById("app") || document.body,
).render(<App />);
