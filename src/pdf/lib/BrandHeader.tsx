import { View, Text, Image, StyleSheet } from "@react-pdf/renderer";
import logoAsset from "@/assets/logo.png.asset.json";
import { PDF, PDF_BRAND } from "./pdfTheme";

// react-pdf needs an absolute URL for Image src in the browser.
const LOGO_URL = (() => {
  if (typeof window !== "undefined" && window.location?.origin) {
    return new URL(logoAsset.url, window.location.origin).toString();
  }
  return logoAsset.url;
})();

const styles = StyleSheet.create({
  header: {
    flexDirection: "row",
    alignItems: "center",
    borderBottom: `1.5pt solid ${PDF.gold}`,
    paddingBottom: 8,
    marginBottom: 10,
  },
  logo: { width: 30, height: 30, marginRight: 10 },
  titleBlock: { flex: 1 },
  brandLine: { fontSize: 8, fontFamily: PDF.fontBold, color: PDF.gold, letterSpacing: 1, textTransform: "uppercase" },
  title: { fontSize: 14, fontFamily: PDF.fontBold, color: PDF.ink },
  subtitle: { fontSize: 7.5, color: PDF.mute, marginTop: 2, letterSpacing: 1, textTransform: "uppercase" },
  meta: { fontSize: 8.5, color: PDF.ink, textAlign: "right", lineHeight: 1.4 },
  metaLabel: { color: PDF.mute },
  footer: {
    position: "absolute",
    left: 24,
    right: 24,
    bottom: 14,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    borderTop: `1pt solid ${PDF.gold}`,
    paddingTop: 5,
    fontSize: 7.5,
    color: PDF.ink,
  },
  footerQuote: { flex: 1, marginHorizontal: 8, textAlign: "center", fontStyle: "italic", color: PDF.mute },
});

export interface HeaderProps {
  title: string;
  subtitle?: string;
  schoolName?: string;
  schoolYear?: string;
  /** Shared export meta (shown right-aligned): generated date + version + quality. */
  generatedDate?: string;
  version?: number | string | null;
  qualityPercent?: number | null;
}

/** The ONE header anatomy every branded PDF uses: logo + product-name band,
 *  title/subtitle, then school/year + generated date/version/quality, gold rule. */
export const BrandHeader = ({ title, subtitle, schoolName, schoolYear, generatedDate, version, qualityPercent }: HeaderProps) => (
  <View style={styles.header} fixed>
    <Image src={LOGO_URL} style={styles.logo} />
    <View style={styles.titleBlock}>
      <Text style={styles.brandLine}>{PDF_BRAND.name}</Text>
      <Text style={styles.title}>{title}</Text>
      {subtitle && <Text style={styles.subtitle}>{subtitle}</Text>}
    </View>
    <View style={styles.meta}>
      {schoolName && (<Text><Text style={styles.metaLabel}>School: </Text>{schoolName}</Text>)}
      {schoolYear && (<Text><Text style={styles.metaLabel}>Year: </Text>{schoolYear}</Text>)}
      {generatedDate && (<Text><Text style={styles.metaLabel}>Generated: </Text>{generatedDate}</Text>)}
      {(version !== undefined && version !== null && version !== "") && (<Text><Text style={styles.metaLabel}>Version: </Text>{String(version)}</Text>)}
      {(qualityPercent !== undefined && qualityPercent !== null) && (<Text><Text style={styles.metaLabel}>Quality: </Text>{qualityPercent}%</Text>)}
    </View>
  </View>
);

interface FooterProps {
  /** Motivational quote line for the footer center (the AI or fallback quote). */
  quote?: string | null;
}

/** The ONE footer anatomy: domain · left, quote · center, page numbers · right. */
export const BrandFooter = ({ quote }: FooterProps) => (
  <View style={styles.footer} fixed>
    <Text>{PDF_BRAND.domain}</Text>
    <Text style={styles.footerQuote}>{quote ? `"${quote}"` : `${PDF_BRAND.footerTag} · ${PDF_BRAND.name}`}</Text>
    <Text render={({ pageNumber, totalPages }) => `Page ${pageNumber} of ${totalPages}`} />
  </View>
);

export const BRAND_COLORS = PDF;
