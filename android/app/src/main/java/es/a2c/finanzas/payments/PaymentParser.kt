package es.a2c.finanzas.payments

import java.text.Normalizer
import java.util.Locale

data class DetectedPayment(
    val amountCents: Long,
    val merchant: String,
    val appName: String,
    val packageName: String,
    val text: String,
    val time: Long,
    val fingerprint: String
)

/**
 * Reconoce pagos con tarjeta en el texto de una notificación (español e inglés).
 * Ejemplos: «Has pagado 12,50 € en MERCADONA», «Compra de 23,40 EUR en AMAZON», «€8.90 at Starbucks».
 */
object PaymentParser {
    /** Bancos y carteras habituales en España. Con «solo apps conocidas» activado se ignoran las demás. */
    val KNOWN_APPS = mapOf(
        "com.google.android.apps.walletnfcrel" to "Google Wallet",
        "com.samsung.android.spay" to "Samsung Wallet",
        "com.samsung.android.samsungpay.gear" to "Samsung Wallet",
        "com.bbva.bbvacontigo" to "BBVA",
        "es.bancosantander.apps" to "Santander",
        "es.lacaixa.mobile.android.newwapicon" to "CaixaBank",
        "com.imaginbank.app" to "imagin",
        "www.ingdirect.nativeframe" to "ING",
        "net.inverline.bancosabadell.officelocator.android" to "Sabadell",
        "es.openbank.mobile" to "Openbank",
        "com.bankinter.launcher" to "Bankinter",
        "es.evobanco.bancamovil" to "EVO Banco",
        "com.revolut.revolut" to "Revolut",
        "de.number26.android" to "N26",
        "com.paypal.android.p2pmobile" to "PayPal",
        "com.wise.android" to "Wise",
        "com.transferwise.android" to "Wise"
    )

    private val amountPatterns = listOf(
        // 1.234,56 € · 12,50€ · 12.50 EUR
        Regex("""(?<![\d.,])(\d{1,3}(?:[.\s ]\d{3})+|\d+)(?:[.,](\d{1,2}))?\s?(?:€|eur\b|euros?\b)""", RegexOption.IGNORE_CASE),
        // €12,50 · EUR 12.50
        Regex("""(?:€|\beur\b)\s?(\d{1,3}(?:[.\s ]\d{3})+|\d+)(?:[.,](\d{1,2}))?(?![\d])""", RegexOption.IGNORE_CASE)
    )
    private val paymentWords = listOf("pago", "pagado", "pagaste", "compra", "cargo", "cobro", "operacion con tarjeta", "transaccion", "has gastado", "gasto", "payment", "paid", "purchase", "spent", "charged")
    private val excludedWords = listOf("recibido", "has recibido", "ingreso", "abono", "devolucion", "reembolso", "transferencia recibida", "bizum recibido", "nomina", "refund", "received", "codigo", "clave", "otp", "verificacion", "verification", "rechazad", "denegad", "declined", "saldo disponible", "oferta", "promocion")
    private val merchantPatterns = listOf(
        Regex("""\b(?:en|at|a)\s+([A-Za-zÀ-ÿ0-9][\wÀ-ÿ&.'*\- ]{1,40}?)(?=\s*(?:[.,;:!()]|\bcon\b|\bel\b|\bel día\b|\bpor\b|\busando\b|\bwith\b|\bon\b|$))""", RegexOption.IGNORE_CASE),
        Regex("""(?:comercio|merchant)\s*:?\s*([A-Za-zÀ-ÿ0-9][\wÀ-ÿ&.'*\- ]{1,40})""", RegexOption.IGNORE_CASE)
    )

    private fun normalize(text: String): String =
        Normalizer.normalize(text, Normalizer.Form.NFD).replace(Regex("\\p{M}+"), "").lowercase(Locale.ROOT)

    fun parse(packageName: String, appName: String, title: String, text: String, time: Long): DetectedPayment? {
        val full = listOf(title, text).filter { it.isNotBlank() }.joinToString(". ")
        if (full.isBlank()) return null
        val plain = normalize(full)
        if (excludedWords.any { plain.contains(it) }) return null
        val isWallet = packageName == "com.google.android.apps.walletnfcrel" || packageName.startsWith("com.samsung.android.spay")
        if (!isWallet && paymentWords.none { plain.contains(it) }) return null

        val amount = amountPatterns.firstNotNullOfOrNull { pattern ->
            pattern.find(full)?.let { match ->
                val units = match.groupValues[1].replace(Regex("[.\\s ]"), "").toLongOrNull() ?: return@let null
                val decimals = match.groupValues.getOrNull(2).orEmpty().padEnd(2, '0').take(2).toLongOrNull() ?: 0L
                units * 100 + decimals
            }
        } ?: return null
        if (amount <= 0 || amount > 2_000_000) return null

        val merchant = merchantPatterns.firstNotNullOfOrNull { it.find(full)?.groupValues?.get(1)?.trim()?.trimEnd('.', '-', '*') }
            ?.takeIf { it.length >= 2 }
            ?: title.takeIf { isWallet && it.isNotBlank() && !normalize(it).contains("pago") }
            ?: "Pago con tarjeta"

        val minute = time / 60000
        val fingerprint = "$packageName|$amount|${normalize(merchant).replace(Regex("[^a-z0-9]"), "")}|${minute / 10}"
        return DetectedPayment(amount, merchant.take(80), appName, packageName, full, time, fingerprint)
    }
}
