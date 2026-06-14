declare module 'mammoth' {
  interface Message {
    type: string;
    message: string;
  }

  interface ConversionResult {
    value: string;
    messages: Message[];
  }

  function convertToHtml(options: { buffer: Buffer }): Promise<ConversionResult>;

  export { convertToHtml };
}
