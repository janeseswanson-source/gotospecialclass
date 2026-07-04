import { Document, Page, Text, View, StyleSheet } from '@react-pdf/renderer';
import { BrandHeader, BrandFooter, BRAND_COLORS as C } from './lib/BrandHeader';
import { PDF_BRAND } from './lib/pdfTheme';

export interface PrepRow {
  question: string;
  answer?: string | null;
}

interface Props {
  schoolName?: string;
  rows: PrepRow[];
}

const styles = StyleSheet.create({
  page: { paddingTop: 28, paddingBottom: 40, paddingHorizontal: 32, fontSize: 10, fontFamily: 'Helvetica', color: C.ink },
  table: { borderTop: `1pt solid ${C.ink}`, borderLeft: `1pt solid ${C.ink}` },
  thead: { flexDirection: 'row', backgroundColor: C.ink },
  th: { padding: 6, fontFamily: 'Helvetica-Bold', color: C.white, fontSize: 10, borderRight: `1pt solid ${C.white}` },
  thAsk: { width: '45%' },
  thAns: { width: '55%' },
  row: { flexDirection: 'row', borderBottom: `1pt solid ${C.ink}`, minHeight: 40 },
  rowAlt: { backgroundColor: C.band },
  cellAsk: { width: '45%', padding: 6, borderRight: `1pt solid ${C.ink}`, fontSize: 10, color: C.ink, fontFamily: 'Helvetica-Bold' },
  cellAns: { width: '55%', padding: 6, borderRight: `1pt solid ${C.ink}`, fontSize: 10, color: C.ink },
});

const CoordinatorPrepDoc = ({ schoolName, rows }: Props) => (
  <Document>
    <Page size="LETTER" style={styles.page}>
      <BrandHeader
        title="Coordinator Prep — Intake Sheet"
        subtitle={`${PDF_BRAND.name} · Pre-Setup Worksheet`}
        schoolName={schoolName}
      />

      <View style={styles.table}>
        <View style={styles.thead} fixed>
          <Text style={[styles.th, styles.thAsk]}>Ask</Text>
          <Text style={[styles.th, styles.thAns]}>Answer</Text>
        </View>
        {rows.map((r, i) => (
          <View key={i} style={[styles.row, i % 2 === 1 ? styles.rowAlt : {}]} wrap={false}>
            <Text style={styles.cellAsk}>{r.question}</Text>
            <Text style={styles.cellAns}>{r.answer && r.answer.trim() ? r.answer : '\u00A0'}</Text>
          </View>
        ))}
      </View>

      <BrandFooter />
    </Page>
  </Document>
);

export default CoordinatorPrepDoc;
