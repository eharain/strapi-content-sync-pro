param(
    [Parameter(Mandatory=$true)] [string] $Label
)
$ErrorActionPreference = 'Continue'
$mysql = 'C:\Program Files\MySQL\MySQL Server 8.0\bin\mysql.exe'
$pw = 'Alcatraz2'
$dbs = @('pos_db','rutba_pos')
$outFile = "D:\Rutba\strapi-plugins\strapi-content-sync-pro\tmp-counts-$Label.tsv"
"side`ttable`tcount" | Out-File -FilePath $outFile -Encoding ASCII
foreach ($db in $dbs) {
    # Get list of relevant tables
    $listQuery = @"
SELECT table_name FROM information_schema.tables
WHERE table_schema = '$db'
  AND table_type = 'BASE TABLE'
  AND (table_name LIKE 'categories' OR table_name LIKE 'customers' OR table_name LIKE 'files' OR table_name LIKE 'files_related_mph' OR table_name LIKE 'products' OR table_name LIKE 'orders' OR table_name LIKE 'offers' OR table_name LIKE 'cms_pages' OR table_name LIKE 'suppliers' OR table_name LIKE 'brands' OR table_name LIKE 'brand_groups' OR table_name LIKE 'category_groups' OR table_name LIKE 'product_groups' OR table_name LIKE 'currencies' OR table_name LIKE 'branches' OR table_name LIKE 'employees' OR table_name LIKE 'terms' OR table_name LIKE 'term_types')
ORDER BY table_name;
"@
    $tables = & $mysql -u root "-p$pw" -h 127.0.0.1 -N -B -e $listQuery 2>$null
    $side = if ($db -eq 'pos_db') { 'remote' } else { 'local' }
    foreach ($t in $tables) {
        if (-not $t) { continue }
        $t = $t.Trim()
        $q = "SELECT COUNT(*) FROM ``$db``.``$t``;"
        $c = & $mysql -u root "-p$pw" -h 127.0.0.1 -N -B -e $q 2>$null
        "$side`t$t`t$($c.Trim())" | Out-File -FilePath $outFile -Append -Encoding ASCII
    }
}
Get-Content $outFile
