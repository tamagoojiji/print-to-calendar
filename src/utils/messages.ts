// ライセンス検証結果のreasonをユーザー向け文言に変換
export function reasonText(reason?: string): string {
  switch (reason) {
    case 'invalid_license':
      return 'ライセンスキーが正しくありません。入力をご確認ください。';
    case 'expired':
      return '利用期限が終了しました。更新料500円でさらに6ヶ月利用できます。';
    case 'revoked':
      return 'このライセンスは無効化されています。お問い合わせください。';
    case 'over_monthly_limit':
      return '今月の読み取り上限（30回）に達しました。翌月1日にリセットされます。';
    default:
      return 'エラーが発生しました。しばらくして再度お試しください。';
  }
}
