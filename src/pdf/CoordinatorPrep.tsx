import { Document, Page, Text, View, StyleSheet, TextInput } from '@react-pdf/renderer';
import { BrandHeader, BrandFooter, BRAND_COLORS as C } from './lib/BrandHeader';
import { PDF_BRAND } from './lib/pdfTheme';

export interface PrepRow {
  question: string;
  answer?: string | null;
  /** Stable machine name for the AcroForm field, so an uploaded sheet can be
   *  read back by name instead of guessed at by an LLM. */
  field?: string;
}

interface Props {
  schoolName?: string;
  rows: PrepRow[];
  /**
   * Emit real AcroForm text inputs instead of flat text.
   *
   * The blank template a coordinator downloads was a static, image-only PDF —
   * "Pretty cool if you can edit it but my pdf is not editable." With this on,
   * every answer cell is a fillable field that Preview/Acrobat/Chrome can type
   * into and save.
   *
   * Off for a filled-in copy meant for printing or filing.
   */
  fillable?: boolean;
}

const styles = StyleSheet.create({
  page: { paddingTop: 28, paddingBottom: 40, paddingHorizontal: 32, fontSize: 10, fontFamily: 'Helvetica', color: C.ink },
  intro: { fontSize: 9, color: C.ink, marginBottom: 8, lineHeight: 1.4 },
  table: { borderTop: `1pt solid ${C.ink}`, borderLeft: `1pt solid ${C.ink}` },
  thead: { flexDirection: 'row', backgroundColor: C.ink },
  th: { padding: 6, fontFamily: 'Helvetica-Bold', color: C.white, fontSize: 10, borderRight: `1pt solid ${C.white}` },
  thAsk: { width: '45%' },
  thAns: { width: '55%' },
  row: { flexDirection: 'row', borderBottom: `1pt solid ${C.ink}`, minHeight: 40 },
  rowAlt: { backgroundColor: C.band },
  cellAsk: { width: '45%', padding: 6, borderRight: `1pt solid ${C.ink}`, fontSize: 10, color: C.ink, fontFamily: 'Helvetica-Bold' },
  cellAns: { width: '55%', padding: 6, borderRight: `1pt solid ${C.ink}`, fontSize: 10, color: C.ink },
  // A form field needs its own box; the surrounding cell keeps the borders.
  cellAnsInput: { width: '55%', borderRight: `1pt solid ${C.ink}`, justifyContent: 'center', paddingHorizontal: 4 },
  input: { fontSize: 10, color: C.ink, height: 22, paddingHorizontal: 4 },
});

/** Machine field name for a question, stable across regenerations. */
export function prepFieldName(row: PrepRow, index: number): string {
  if (row.field) return row.field;
  const slug = row.question
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 40);
  return slug || `q_${index + 1}`;
}

const CoordinatorPrepDoc = ({ schoolName, rows, fillable = false }: Props) => (
  <Document>
    <Page size="LETTER" style={styles.page}>
      <BrandHeader
        title="Coordinator Prep — Intake Sheet"
        subtitle={`${PDF_BRAND.name} · Pre-Setup Worksheet`}
        schoolName={schoolName}
      />

      {fillable && (
        <Text style={styles.intro}>
          You can type straight into this PDF and save it, or print it and write by hand — either way,
          upload it when you're done and we'll fill in your School Info answers. You'll still add
          specialists, teachers and bell times in the wizard.
        </Text>
      )}

      <View style={styles.table}>
        <View style={styles.thead} fixed>
          <Text style={[styles.th, styles.thAsk]}>Ask</Text>
          <Text style={[styles.th, styles.thAns]}>Answer</Text>
        </View>
        {rows.map((r, i) => (
          <View key={i} style={[styles.row, i % 2 === 1 ? styles.rowAlt : {}]} wrap={false}>
            <Text style={styles.cellAsk}>{r.question}</Text>
            {fillable ? (
              <View style={styles.cellAnsInput}>
                <TextInput
                  name={prepFieldName(r, i)}
                  value={r.answer && r.answer.trim() ? r.answer : ''}
                  style={styles.input}
                />
              </View>
            ) : (
              <Text style={styles.cellAns}>{r.answer && r.answer.trim() ? r.answer : ' '}</Text>
            )}
          </View>
        ))}
      </View>

      <BrandFooter />
    </Page>
  </Document>
);

export default CoordinatorPrepDoc;
