import { useEffect, useRef } from "react";

interface MathRendererProps {
  html: string;
  className?: string;
}

/**
 * Renders HTML content with math expression support.
 * Processes <math-frac>, <math-sqrt>, <sup>, <sub> tags
 * and also handles LaTeX-style notation like \frac{}{}, \sqrt{}, ^{}, _{}
 */
function processMathInHtml(html: string): string {
  // Process LaTeX-style fractions: \frac{num}{den}
  html = html.replace(/\\frac\{([^}]+)\}\{([^}]+)\}/g, (_, num, den) =>
    `<span class="math-frac"><span class="math-num">${num}</span><span class="math-den">${den}</span></span>`
  );

  // Process LaTeX-style sqrt: \sqrt{expr}
  html = html.replace(/\\sqrt\{([^}]+)\}/g, (_, expr) =>
    `<span class="math-sqrt"><span class="math-sqrt-inner">${expr}</span></span>`
  );

  // Process LaTeX-style superscript: ^{expr} or x^2
  html = html.replace(/\^{([^}]+)}/g, (_, exp) =>
    `<sup class="math-sup">${exp}</sup>`
  );
  html = html.replace(/\^(\w)/g, (_, exp) =>
    `<sup class="math-sup">${exp}</sup>`
  );

  // Process LaTeX-style subscript: _{expr} or x_2
  html = html.replace(/_{([^}]+)}/g, (_, sub) =>
    `<sub class="math-sub">${sub}</sub>`
  );

  // Process display math blocks: $$...$$
  html = html.replace(/\$\$([^$]+)\$\$/g, (_, expr) =>
    `<div class="math-block">${processMathInHtml(expr)}</div>`
  );

  // Process inline math: $...$
  html = html.replace(/\$([^$\n]+)\$/g, (_, expr) =>
    `<span style="font-family:'Georgia','Times New Roman',serif">${processMathInHtml(expr)}</span>`
  );

  // Process fraction notation: a/b where a and b are numbers/simple expressions
  // Only process when surrounded by spaces or at start/end to avoid URLs
  html = html.replace(/(?<![:/\w])(\d+)\s*\/\s*(\d+)(?![\w/])/g, (_, num, den) =>
    `<span class="math-frac"><span class="math-num">${num}</span><span class="math-den">${den}</span></span>`
  );

  return html;
}

export default function MathRenderer({ html, className = "" }: MathRendererProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  const processedHtml = processMathInHtml(html);

  return (
    <div
      ref={containerRef}
      className={`prose-html ${className}`}
      dangerouslySetInnerHTML={{ __html: processedHtml }}
    />
  );
}
