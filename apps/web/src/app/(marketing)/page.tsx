import { Faq } from "@/components/landing/Faq";
import { FinalCta } from "@/components/landing/FinalCta";
import { Hero } from "@/components/landing/Hero";
import { Pillars } from "@/components/landing/Pillars";
import { SwitchSection } from "@/components/landing/SwitchSection";

export default function HomePage() {
  return (
    <>
      <Hero />
      <Pillars />
      <SwitchSection />
      <Faq />
      <FinalCta />
    </>
  );
}
