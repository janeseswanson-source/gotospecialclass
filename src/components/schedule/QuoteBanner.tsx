import { Quote } from "lucide-react";

interface QuoteBannerProps {
  text: string;
  author: string;
}

export default function QuoteBanner({ text, author }: QuoteBannerProps) {
  return (
    <div className="relative overflow-hidden rounded-xl bg-gradient-to-r from-primary to-primary/80 p-5 text-primary-foreground">
      <Quote className="absolute right-4 top-3 h-12 w-12 opacity-15" />
      <p className="text-sm font-medium italic leading-relaxed">"{text}"</p>
      <p className="mt-1 text-xs opacity-80">— {author}</p>
    </div>
  );
}
