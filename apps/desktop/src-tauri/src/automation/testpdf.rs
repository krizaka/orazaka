//! A minimal, valid, one-page PDF with real text (Helvetica, one `Tj` per line) — the fixture of the runner's tests and
//! of the end-to-end test. Written by hand so the tests need no PDF library and no binary fixture in the repository.

fn escape(line: &str) -> String {
    line.replace('\\', "\\\\").replace('(', "\\(").replace(')', "\\)")
}

pub fn minimal_pdf(text: &str) -> Vec<u8> {
    let mut content = String::from("BT /F1 11 Tf 14 TL 56 780 Td\n");
    for line in text.lines() {
        content.push_str(&format!("({}) Tj T*\n", escape(line)));
    }
    content.push_str("ET");
    let objects = [
        "<< /Type /Catalog /Pages 2 0 R >>".to_string(),
        "<< /Type /Pages /Kids [3 0 R] /Count 1 >>".to_string(),
        "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>".to_string(),
        format!("<< /Length {} >>\nstream\n{}\nendstream", content.len(), content),
        "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>".to_string(),
    ];
    let mut pdf = String::from("%PDF-1.4\n");
    let mut offsets = Vec::new();
    for (i, body) in objects.iter().enumerate() {
        offsets.push(pdf.len());
        pdf.push_str(&format!("{} 0 obj\n{}\nendobj\n", i + 1, body));
    }
    let xref = pdf.len();
    pdf.push_str(&format!("xref\n0 {}\n0000000000 65535 f \n", objects.len() + 1));
    for o in offsets {
        pdf.push_str(&format!("{o:010} 00000 n \n"));
    }
    pdf.push_str(&format!("trailer\n<< /Size {} /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF\n", objects.len() + 1));
    pdf.into_bytes()
}

#[cfg(test)]
mod tests {
    #[test]
    fn its_text_can_be_extracted() {
        let pdf = super::minimal_pdf("Lease between Eric and Marie\nRent: 1200 dollars (monthly)");
        let text = super::super::runner::pdf_text(&pdf).unwrap();
        assert!(text.contains("Lease between Eric and Marie"), "{text}");
        assert!(text.contains("Rent: 1200 dollars (monthly)"), "{text}");
    }
}
