import { useState } from "react";
import { motion } from "framer-motion";
import { BookOpen, GraduationCap, Globe, X } from "lucide-react";

const GRADES = [
  "Class 1", "Class 2", "Class 3", "Class 4", "Class 5",
  "Class 6", "Class 7", "Class 8", "Class 9", "Class 10",
  "Class 11", "Class 12",
  "Undergraduate (Year 1)", "Undergraduate (Year 2)", "Undergraduate (Year 3)", "Undergraduate (Year 4)",
  "Postgraduate", "PhD / Research",
  "Competitive Exam (JEE)", "Competitive Exam (NEET)", "Competitive Exam (UPSC)",
  "Competitive Exam (CAT)", "Competitive Exam (GATE)", "Other",
];

const BOARDS = [
  "CBSE", "ICSE / ISC", "State Board (Maharashtra)", "State Board (UP)",
  "State Board (Tamil Nadu)", "State Board (Karnataka)", "State Board (Rajasthan)",
  "State Board (Gujarat)", "State Board (West Bengal)", "State Board (Other)",
  "IB (International Baccalaureate)", "Cambridge (IGCSE / A-Level)",
  "NIOS", "Other",
];

const LANGUAGES = [
  "English", "Hindi", "Tamil", "Telugu", "Kannada", "Malayalam",
  "Marathi", "Bengali", "Gujarati", "Punjabi", "Urdu", "Other",
];

interface StudyProfileModalProps {
  onSave: (grade: string, board: string, language: string) => void;
  onSkip: () => void;
  existingGrade?: string | null;
  existingBoard?: string | null;
  existingLanguage?: string | null;
}

export default function StudyProfileModal({
  onSave,
  onSkip,
  existingGrade,
  existingBoard,
  existingLanguage,
}: StudyProfileModalProps) {
  const [grade, setGrade] = useState(existingGrade ?? "");
  const [board, setBoard] = useState(existingBoard ?? "");
  const [language, setLanguage] = useState(existingLanguage ?? "English");

  const canSave = grade && board && language;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-background/80 backdrop-blur-sm" />
      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 10 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: 10 }}
        transition={{ duration: 0.2 }}
        className="relative z-10 bg-card border border-border rounded-2xl shadow-2xl w-full max-w-md p-6"
      >
        {/* Header */}
        <div className="flex items-center justify-between mb-5">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-indigo-400/15 border border-indigo-400/30 flex items-center justify-center">
              <GraduationCap className="h-5 w-5 text-indigo-400" />
            </div>
            <div>
              <h3 className="text-base font-bold text-foreground">Set Up Study Profile</h3>
              <p className="text-[11px] text-muted-foreground">Personalise your AI study companion</p>
            </div>
          </div>
          <button onClick={onSkip} className="text-muted-foreground hover:text-foreground transition-colors p-1">
            <X className="h-4 w-4" />
          </button>
        </div>

        <p className="text-xs text-muted-foreground mb-5 leading-relaxed">
          Tell us your grade and board so the AI knows exactly which textbooks, chapters, and exam patterns to use — no more guessing.
        </p>

        <div className="space-y-4">
          {/* Grade */}
          <div>
            <label className="flex items-center gap-1.5 text-[11px] font-bold text-foreground mb-2">
              <BookOpen className="h-3.5 w-3.5 text-indigo-400" />
              Grade / Level
            </label>
            <select
              value={grade}
              onChange={e => setGrade(e.target.value)}
              className="w-full bg-background border border-border rounded-xl px-3 py-2.5 text-sm text-foreground focus:outline-none focus:border-indigo-400/60 transition-colors"
            >
              <option value="">Select your grade...</option>
              {GRADES.map(g => <option key={g} value={g}>{g}</option>)}
            </select>
          </div>

          {/* Board */}
          <div>
            <label className="flex items-center gap-1.5 text-[11px] font-bold text-foreground mb-2">
              <GraduationCap className="h-3.5 w-3.5 text-indigo-400" />
              Board / Curriculum
            </label>
            <select
              value={board}
              onChange={e => setBoard(e.target.value)}
              className="w-full bg-background border border-border rounded-xl px-3 py-2.5 text-sm text-foreground focus:outline-none focus:border-indigo-400/60 transition-colors"
            >
              <option value="">Select your board...</option>
              {BOARDS.map(b => <option key={b} value={b}>{b}</option>)}
            </select>
          </div>

          {/* Language */}
          <div>
            <label className="flex items-center gap-1.5 text-[11px] font-bold text-foreground mb-2">
              <Globe className="h-3.5 w-3.5 text-indigo-400" />
              Preferred Language
            </label>
            <select
              value={language}
              onChange={e => setLanguage(e.target.value)}
              className="w-full bg-background border border-border rounded-xl px-3 py-2.5 text-sm text-foreground focus:outline-none focus:border-indigo-400/60 transition-colors"
            >
              {LANGUAGES.map(l => <option key={l} value={l}>{l}</option>)}
            </select>
          </div>
        </div>

        <div className="flex gap-2 mt-6">
          <button
            onClick={onSkip}
            className="flex-1 py-2.5 bg-card border border-border text-muted-foreground text-sm rounded-xl hover:bg-muted/50 transition-all"
          >
            Skip for now
          </button>
          <button
            onClick={() => canSave && onSave(grade, board, language)}
            disabled={!canSave}
            className="flex-2 flex-grow py-2.5 bg-indigo-500 text-white text-sm font-bold rounded-xl hover:bg-indigo-600 disabled:opacity-40 disabled:cursor-not-allowed transition-all"
          >
            Save Profile
          </button>
        </div>
      </motion.div>
    </div>
  );
}
