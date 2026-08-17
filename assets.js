// In market-data.js
async getQuotes(symbolsMap) {
    const results = [];
    await Promise.all(
      Object.entries(symbolsMap).map(async ([symbol, type]) => {
        try {
          const quote = await this.api.getQuote(symbol, { type });
          results.push({ symbol, quote, error: null });
        } catch (err) {
          results.push({ symbol, quote: null, error: err });
        }
      })
    );
    return results;
}