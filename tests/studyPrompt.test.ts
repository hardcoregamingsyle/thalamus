// Deterministic tests for the study-mode adaptation layer. Every claim the
// pitch makes about "answers matched to the student's grade and board" rests
// on the mapping tested here — if these are green, the right instructions
// reach the model for every profile the UI can produce (and plenty it can't).
import { describe, it, expect } from "bun:test";
import { gradeBand, boardProfile, buildStudySystemPrompt } from "../src/convex/studyPrompt";

describe("gradeBand", () => {
  const cases: Array<[string, string]> = [
    // Primary 1-5
    ["Class 1", "primary"], ["Class 3", "primary"], ["Class 5", "primary"],
    // Middle 6-8
    ["Class 6", "middle"], ["Class 7", "middle"], ["Class 8", "middle"],
    ["Grade 7", "middle"], ["7th", "middle"], ["std 8", "middle"],
    // Secondary 9-10
    ["Class 9", "secondary"], ["Class 10", "secondary"], ["Grade 10", "secondary"],
    // Senior 11-12
    ["Class 11", "senior"], ["Class 12", "senior"], ["12th", "senior"],
    // Undergrad
    ["Undergraduate Year 1", "undergrad"], ["Undergraduate Year 4", "undergrad"],
    ["B.Tech", "undergrad"], ["BSc", "undergrad"], ["College", "undergrad"],
    // Postgrad / research
    ["Postgraduate", "postgrad"], ["PhD/Research", "postgrad"], ["Masters", "postgrad"],
    ["M.Tech", "postgrad"], ["MBA", "postgrad"],
    // Competitive
    ["Competitive Exam (JEE)", "competitive"], ["NEET", "competitive"],
    ["UPSC", "competitive"], ["GATE", "competitive"], ["CAT", "competitive"],
  ];
  for (const [input, expected] of cases) {
    it(`maps "${input}" → ${expected}`, () => {
      expect(gradeBand(input)).toBe(expected);
    });
  }

  it("defaults to secondary for null/empty/garbage", () => {
    expect(gradeBand(null)).toBe("secondary");
    expect(gradeBand(undefined)).toBe("secondary");
    expect(gradeBand("")).toBe("secondary");
    expect(gradeBand("Other")).toBe("secondary");
  });
});

describe("boardProfile", () => {
  const cases: Array<[string, string]> = [
    // Indian national
    ["CBSE", "CBSE"], ["cbse", "CBSE"], ["NCERT", "CBSE"], ["Central Board", "CBSE"],
    ["ICSE", "ICSE/ISC"], ["ISC", "ICSE/ISC"], ["CISCE", "ICSE/ISC"],
    ["NIOS", "NIOS"],
    // Indian state boards (the modal's list and common spellings)
    ["State Board (Maharashtra)", "Maharashtra State Board"], ["MSBSHSE", "Maharashtra State Board"],
    ["State Board (UP)", "UP Board"], ["Uttar Pradesh Board", "UP Board"],
    ["State Board (Tamil Nadu)", "Tamil Nadu State Board"], ["Samacheer Kalvi", "Tamil Nadu State Board"],
    ["State Board (Karnataka)", "Karnataka State Board"], ["KSEEB", "Karnataka State Board"], ["PUC", "Karnataka State Board"],
    ["State Board (Rajasthan)", "Rajasthan Board"], ["RBSE", "Rajasthan Board"],
    ["State Board (Gujarat)", "Gujarat Board"], ["GSEB", "Gujarat Board"],
    ["State Board (West Bengal)", "West Bengal Board"], ["WBBSE", "West Bengal Board"],
    ["Kerala State Board", "Kerala State Board"], ["SCERT Kerala", "Kerala State Board"],
    ["Telangana Board", "AP/Telangana Board"], ["Andhra Pradesh BSEAP", "AP/Telangana Board"],
    ["Punjab Board PSEB", "State Board"], ["Bihar Board BSEB", "State Board"],
    ["MPBSE", "State Board"], ["CGBSE", "State Board"], ["SEBA Assam", "State Board"],
    ["State Board (Other)", "State Board"],
    // International
    ["IB", "IB"], ["International Baccalaureate", "IB"], ["IB DP", "IB"], ["MYP", "IB"],
    ["Cambridge (IGCSE)", "Cambridge"], ["IGCSE", "Cambridge"], ["Cambridge A-Level", "Cambridge"], ["CAIE", "Cambridge"],
    ["GCSE", "UK GCSE/A-Level"], ["A-Level (Edexcel)", "UK GCSE/A-Level"], ["AQA", "UK GCSE/A-Level"], ["OCR", "UK GCSE/A-Level"],
    ["AP", "US (AP/Common Core)"], ["Advanced Placement", "US (AP/Common Core)"], ["Common Core", "US (AP/Common Core)"],
  ];
  for (const [input, family] of cases) {
    it(`maps "${input}" → ${family}`, () => {
      expect(boardProfile(input).family).toBe(family);
    });
  }

  it("falls back to General for unknown boards", () => {
    expect(boardProfile("Some Unknown Board").family).toBe("General");
    expect(boardProfile(null).family).toBe("General");
    expect(boardProfile(undefined).family).toBe("General");
  });

  it("every family has non-empty conventions", () => {
    const boards = ["CBSE", "ICSE", "Maharashtra", "UP Board", "Tamil Nadu", "Karnataka",
      "Rajasthan", "Gujarat", "West Bengal", "Kerala", "Telangana", "Punjab PSEB",
      "IB", "IGCSE", "GCSE", "AP", "NIOS", "totally unknown"];
    for (const b of boards) {
      const p = boardProfile(b);
      expect(p.conventions.length).toBeGreaterThan(80);
      expect(p.conventions).toContain("BOARD:");
    }
  });
});

describe("buildStudySystemPrompt", () => {
  it("includes the profile, band guidance, and board conventions", () => {
    const prompt = buildStudySystemPrompt({ grade: "Class 10", board: "CBSE", language: "English" });
    expect(prompt).toContain("Class 10");
    expect(prompt).toContain("first board exams");        // secondary band guidance
    expect(prompt).toContain("step-marking");             // CBSE conventions
    expect(prompt).toContain("NEVER ask for clarification");
    expect(prompt).toContain("clean semantic HTML");      // output contract
  });

  it("adapts depth between grade 6 and PhD", () => {
    const middle = buildStudySystemPrompt({ grade: "Class 6", board: "CBSE" });
    const phd = buildStudySystemPrompt({ grade: "PhD/Research", board: "Other" });
    expect(middle).toContain("Middle school");
    expect(middle).toContain("12-year-old");
    expect(phd).toContain("research");
    expect(phd).toContain("Never dumb down");
    expect(middle).not.toContain("Never dumb down");
    expect(phd).not.toContain("12-year-old");
  });

  it("handles mark-weighted exam answers", () => {
    const prompt = buildStudySystemPrompt({ grade: "Class 12", board: "CBSE" });
    expect(prompt).toContain("mark weight");
    expect(prompt).toMatch(/5-mark/);
  });

  it("adds a language directive for non-English preferences only", () => {
    const hindi = buildStudySystemPrompt({ grade: "Class 8", board: "CBSE", language: "Hindi" });
    expect(hindi).toContain("Answer in Hindi");
    expect(hindi).toContain("technical/scientific terms in English");
    const english = buildStudySystemPrompt({ grade: "Class 8", board: "CBSE", language: "English" });
    expect(english).not.toContain("Answer in English,");
  });

  it("marks the student's own material as the primary source when RAG context exists", () => {
    const prompt = buildStudySystemPrompt({
      grade: "Class 9", board: "ICSE",
      ragContext: "## Relevant knowledge\nPhotosynthesis notes from uploaded PDF",
      graphContext: "## Knowledge graph\nchlorophyll → absorbs → light",
    });
    expect(prompt).toContain("primary source");
    expect(prompt).toContain("Photosynthesis notes from uploaded PDF");
    expect(prompt).toContain("chlorophyll → absorbs → light");
  });

  it("falls back to resource titles when no RAG hits", () => {
    const prompt = buildStudySystemPrompt({
      grade: "Class 9", board: "CBSE",
      resourceTitles: ["Physics Ch4 notes.pdf", "History dates.txt"],
    });
    expect(prompt).toContain("Physics Ch4 notes.pdf");
    expect(prompt).not.toContain("primary source");
  });

  it("includes admin knowledge base when provided", () => {
    const prompt = buildStudySystemPrompt({ adminContext: "[School Syllabus]: Term 2 covers optics" });
    expect(prompt).toContain("SCHOOL KNOWLEDGE BASE");
    expect(prompt).toContain("Term 2 covers optics");
  });

  it("produces a sane prompt with no profile at all", () => {
    const prompt = buildStudySystemPrompt();
    expect(prompt).toContain("not set");
    expect(prompt).toContain("NEVER ask");
    expect(prompt.length).toBeGreaterThan(500);
  });

  it("leads with mark-efficiency: what scores, what to skip, answer skeletons", () => {
    const prompt = buildStudySystemPrompt({ grade: "Class 10", board: "CBSE" });
    expect(prompt).toContain("MAXIMUM MARKS, MINIMUM WASTED EFFORT");
    expect(prompt).toContain("80/20");
    expect(prompt).toContain("answer skeletons");
    expect(prompt).toContain("skip low-yield material");
    expect(prompt).toContain("halve revision time");
    // The crammer path: urgency changes answer order
    expect(prompt).toContain("Exam tomorrow");
  });

  it("runs a teaching loop, not an answer dump", () => {
    const prompt = buildStudySystemPrompt({ grade: "Class 8", board: "CBSE" });
    expect(prompt).toContain("TEACH — DON'T JUST HAND OVER ANSWERS");
    expect(prompt).toContain("Your turn");                 // always ends with a rep
    expect(prompt).toContain("grade the attempt FIRST");   // feedback on student attempts
    expect(prompt).toContain("exact step where it went wrong");
    expect(prompt).toContain("change the route");          // adapts when confused
    expect(prompt).toContain("active recall");
    expect(prompt).toContain("reproduce ALONE in the exam hall");
  });

  it("mark-efficiency applies at every band, not just school", () => {
    for (const grade of ["Class 6", "Class 12", "Undergraduate Year 2", "PhD/Research", "Competitive Exam (NEET)"]) {
      const prompt = buildStudySystemPrompt({ grade, board: "CBSE" });
      expect(prompt).toContain("MAXIMUM MARKS, MINIMUM WASTED EFFORT");
    }
  });

  it("IB gets command terms, Cambridge gets mark schemes, competitive gets strategy", () => {
    expect(buildStudySystemPrompt({ grade: "Class 11", board: "IB" })).toContain("command terms");
    expect(buildStudySystemPrompt({ grade: "Class 10", board: "IGCSE" })).toContain("command words");
    expect(buildStudySystemPrompt({ grade: "Competitive Exam (JEE)", board: "CBSE" })).toContain("previous-year question patterns");
  });
});
