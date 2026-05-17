/// <reference path="./anime-torrent-provider.d.ts" />
/// <reference path="./core.d.ts" />

interface AnimeToshoTorrent {
    id: number;
    title: string;
    link: string;
    timestamp: number;
    status: string;
    tosho_id?: number;
    nyaa_id?: number;
    nyaa_subdom?: any;
    anidex_id?: number;
    torrent_url: string;
    info_hash: string;
    info_hash_v2?: string;
    magnet_uri: string;
    seeders: number;
    leechers: number;
    torrent_download_count: number;
    tracker_updated?: any;
    nzb_url?: string;
    total_size: number;
    num_files: number;
    anidb_aid: number;
    anidb_eid: number;
    anidb_fid: number;
    article_url: string;
    article_title: string;
    website_url: string;
}

class Provider {
    private apiUrl = "https://feed.animetosho.xyz/api"

    public getSettings(): AnimeProviderSettings {
        return {
            type: "main",
            canSmartSearch: true,
            smartSearchFilters: ["batch", "episodeNumber", "resolution"],
            supportsAdult: true,
        }
    }

    private getApiUrl() {
        let url = $getUserPreference("apiUrl") || this.apiUrl
        if (url.endsWith("/")) url = url.slice(0, -1)
        if (!url.startsWith("http")) url = "https://" + url
        return url
    }

    private getApiKey() {
        return $getUserPreference("apiKey") || ""
    }

    private buildApiUrl(params: { [key: string]: string }) {
        const baseUrl = this.getApiUrl()
        const query: string[] = []
        for (const [key, value] of Object.entries(params)) {
            query.push(`${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
        }
        return query.length > 0 ? `${baseUrl}?${query.join("&")}` : baseUrl
    }

    public async getLatest(): Promise<AnimeTorrent[]> {
        try {
            console.log("AnimeTosho: Fetching latest torrents")
            const url = this.buildApiUrl({ q: "" })
            const torrents = await this.fetchTorrents(url)
            return this.torrentSliceToAnimeTorrentSlice(torrents, false, null)
        }
        catch (error) {
            console.error("AnimeTosho: Error fetching latest: " + (error as Error).message)
            return []
        }
    }

    public async search(options: AnimeSearchOptions): Promise<AnimeTorrent[]> {
        try {
            console.log(`AnimeTosho: Searching for "${options.query}"`)
            const query = this.sanitizeTitle(options.query)
            const url = this.buildApiUrl({ q: query })
            const torrents = await this.fetchTorrents(url)
            return this.torrentSliceToAnimeTorrentSlice(torrents, false, options.media)
        }
        catch (error) {
            console.error("AnimeTosho: Error searching: " + (error as Error).message)
            return []
        }
    }

    public async smartSearch(options: AnimeSmartSearchOptions): Promise<AnimeTorrent[]> {
        try {
            if (options.batch) {
                console.log("AnimeTosho: Smart searching for batches...")
                return this.smartSearchBatch(options)
            }
            console.log(`AnimeTosho: Smart searching for episode ${options.episodeNumber}...`)
            return this.smartSearchSingleEpisode(options)
        }
        catch (error) {
            console.error("AnimeTosho: Error in smart search: " + (error as Error).message)
            return []
        }
    }

    private async smartSearchBatch(options: AnimeSmartSearchOptions): Promise<AnimeTorrent[]> {
        let atTorrents: AnimeToshoTorrent[] = []
        let foundByID = false
        const media = options.media

        const isMovieOrSingle = media.format === "MOVIE" || media.episodeCount === 1

        if (options.anidbAID && options.anidbAID > 0) {
            console.log(`AnimeTosho: Searching batches by AID ${options.anidbAID}`)
            try {
                const torrents = await this.searchByAID(options.anidbAID, options.resolution || "")

                // If it's a movie/single-ep, all torrents are considered "batches"
                if (isMovieOrSingle) {
                    atTorrents = torrents
                } else {
                    // Otherwise, filter for actual batches (multi-file)
                    const batchTorrents = torrents.filter(t => t.num_files > 1)
                    // If we found batches, use them. If not, use all torrents (e.g., for OVAs released as single files)
                    atTorrents = batchTorrents.length > 0 ? batchTorrents : torrents
                }

                if (atTorrents.length > 0) {
                    foundByID = true
                }
            }
            catch (e) {
                console.warn("AnimeTosho: searchByAID failed: " + (e as Error).message)
            }
        }

        if (foundByID) {
            console.log(`AnimeTosho: Found ${atTorrents.length} batches by AID`)
            return this.torrentSliceToAnimeTorrentSlice(atTorrents, true, media)
        }

        // Fallback: Search by query
        console.log("AnimeTosho: Searching batches by query")
        const queries = this.buildSmartSearchQueries(options)
        let allTorrents: AnimeToshoTorrent[] = []

        const searchPromises = queries.map(query => {
            const url = this.buildApiUrl({ only_tor: "1", q: query, order: "size-d" })
            return this.fetchTorrents(url)
        })

        try {
            const results = await Promise.all(searchPromises)
            allTorrents = results.flat()
        }
        catch (error) {
            console.error("AnimeTosho: Batch query search failed: " + (error as Error).message)
            return []
        }

        // Filter out single-file torrents unless it's a movie/single-ep
        allTorrents = allTorrents.filter(t => isMovieOrSingle || t.num_files > 1)

        // Convert and remove duplicates
        const animeTorrents = this.torrentSliceToAnimeTorrentSlice(allTorrents, false, media)
        const uniqueTorrents = [...new Map(animeTorrents.map(t => [t.link, t])).values()]

        console.log(`AnimeTosho: Found ${uniqueTorrents.length} batches by query`)
        return uniqueTorrents
    }

    private async smartSearchSingleEpisode(options: AnimeSmartSearchOptions): Promise<AnimeTorrent[]> {
        let atTorrents: AnimeToshoTorrent[] = []
        let foundByID = false
        const media = options.media

        const isMovieOrSingle = media.format === "MOVIE" || media.episodeCount === 1

        if (options.anidbEID && options.anidbEID > 0) {
            console.log(`AnimeTosho: Searching episode by EID ${options.anidbEID}`)
            try {
                const torrents = await this.searchByEID(options.anidbEID, options.resolution || "")
                // Filter for single-file torrents
                atTorrents = torrents.filter(t => t.num_files === 1)

                if (atTorrents.length > 0) {
                    foundByID = true
                }
            }
            catch (e) {
                console.warn("AnimeTosho: searchByEID failed: " + (e as Error).message)
            }
        }

        if (foundByID) {
            console.log(`AnimeTosho: Found ${atTorrents.length} episodes by EID`)
            return this.torrentSliceToAnimeTorrentSlice(atTorrents, true, media)
        }

        // Fallback: Search by query
        console.log("AnimeTosho: Searching episode by query")
        const queries = this.buildSmartSearchQueries(options)
        let allTorrents: AnimeToshoTorrent[] = []

        const searchPromises = queries.map(query => {
            const url = this.buildApiUrl({ only_tor: "1", q: query, qx: "1" })
            return this.fetchTorrents(url)
        })

        try {
            const results = await Promise.all(searchPromises)
            allTorrents = results.flat()
        }
        catch (error) {
            console.error("AnimeTosho: Episode query search failed: " + (error as Error).message)
            return []
        }

        // Filter for single-file torrents, unless it's a movie (which might be multi-file)
        allTorrents = allTorrents.filter(t => isMovieOrSingle || t.num_files === 1)

        // Convert and remove duplicates
        const animeTorrents = this.torrentSliceToAnimeTorrentSlice(allTorrents, false, media)
        const uniqueTorrents = [...new Map(animeTorrents.map(t => [t.link, t])).values()]

        console.log(`AnimeTosho: Found ${uniqueTorrents.length} episodes by query`)
        return uniqueTorrents
    }

    public async getTorrentInfoHash(torrent: AnimeTorrent): Promise<string> {
        // InfoHash is provided directly by the API
        return torrent.infoHash || ""
    }

    public async getTorrentMagnetLink(torrent: AnimeTorrent): Promise<string> {
        // MagnetLink is provided directly by the API
        return torrent.magnetLink || ""
    }

    //+ --------------------------------------------------------------------------------------------------
    // Helpers
    //+ --------------------------------------------------------------------------------------------------

    private async fetchTorrents(url: string): Promise<AnimeToshoTorrent[]> {
        console.log(`AnimeTosho: Fetching from ${url}`)

        const requestOptions: any = {}
        const apiKey = this.getApiKey()
        if (apiKey) {
            requestOptions.headers = {
                "X-API-Key": apiKey,
                "Accept": "application/rss+xml, application/xml, text/xml, */*",
            }
        }

        const res = await fetch(url, requestOptions)
        if (!res.ok) {
            throw new Error(`Failed to fetch torrents: ${res.status} ${res.statusText}`)
        }

        const text = res.text()
        const torrents = this.parseRssFeed(text)
        

        // Clean up impossibly high seeder/leecher counts
        return torrents.map(t => {
            if (t.seeders > 100000) t.seeders = 0
            if (t.leechers > 100000) t.leechers = 0
            return t
        })
    }

    private parseRssFeed(xmlText: string): AnimeToshoTorrent[] {
        const decodeHtmlEntities = (value: string) => {
            return value.replace(/&(#?(?:x[0-9A-Fa-f]+|\d+));/g, (match, code) => {
                if (code.startsWith("#x") || code.startsWith("#X")) {
                    return String.fromCharCode(parseInt(code.slice(2), 16))
                }
                if (code.startsWith("#")) {
                    return String.fromCharCode(parseInt(code.slice(1), 10))
                }
                switch (code.toLowerCase()) {
                    case "amp": return "&"
                    case "lt": return "<"
                    case "gt": return ">"
                    case "quot": return '"'
                    case "apos": return "'"
                    default: return match
                }
            })
        }

        const getTagText = (text: string, tag: string) => {
            const re = new RegExp("<" + tag + "[^>]*>([\\s\\S]*?)<\\/" + tag + ">", "i")
            const match = text.match(re)
            let value = match ? match[1].trim() : ""
            if (value.startsWith("<![CDATA[")) {
                value = value.slice(9, value.endsWith("]]>") ? -3 : undefined)
            }
            return decodeHtmlEntities(value.trim())
        }

        const getAttributeValue = (text: string, tagName: string, attrName: string, attrValue: string, returnAttr: string) => {
            const re = new RegExp("<" + tagName + "[^>]*" + attrName + "=(?:\"|\')" + attrValue + "(?:\"|\')[^>]*" + returnAttr + "=(?:\"|\')([^\"\']*)(?:\"|\')[^>]*>", "i")
            const match = text.match(re)
            return match ? decodeHtmlEntities(match[1]) : ""
        }

        const getSingleAttrValue = (text: string, tagName: string, attrName: string) => {
            const re = new RegExp("<" + tagName + "[^>]*" + attrName + "=(?:\"|\')([^\"\']*)(?:\"|\')[^>]*>", "i")
            const match = text.match(re)
            return match ? decodeHtmlEntities(match[1]) : ""
        }

        const itemRegex = /<item[^>]*>([\s\S]*?)<\/item>/gi
        const results: AnimeToshoTorrent[] = []
        let match: RegExpExecArray | null
        let index = 0

        while ((match = itemRegex.exec(xmlText)) !== null) {
            const itemText = match[1]
            const title = getTagText(itemText, "title") || getTagText(itemText, "description")
            const link = getTagText(itemText, "link")
            const pubDate = getTagText(itemText, "pubDate")
            const torrentUrl = getSingleAttrValue(itemText, "enclosure", "url")
            const sourceUrl = getSingleAttrValue(itemText, "source", "url")
            const magnetUri = getAttributeValue(itemText, "torznab:attr", "name", "magneturl", "value") || getAttributeValue(itemText, "newznab:attr", "name", "magneturl", "value")
            const infoHash = getAttributeValue(itemText, "torznab:attr", "name", "infohash", "value") || getAttributeValue(itemText, "newznab:attr", "name", "infohash", "value")
            const totalSize = parseInt(getAttributeValue(itemText, "torznab:attr", "name", "size", "value") || getAttributeValue(itemText, "newznab:attr", "name", "size", "value") || "0", 10)
            const seeders = parseInt(getAttributeValue(itemText, "torznab:attr", "name", "seeders", "value") || getAttributeValue(itemText, "newznab:attr", "name", "seeders", "value") || "0", 10)
            const leechers = parseInt(getAttributeValue(itemText, "torznab:attr", "name", "leechers", "value") || getAttributeValue(itemText, "newznab:attr", "name", "leechers", "value") || "0", 10)
            let timestamp = 0
            if (pubDate) {
                const parsed = Date.parse(pubDate)
                timestamp = Number.isNaN(parsed) ? 0 : Math.floor(parsed / 1000)
            }
            const id = parseInt((link || "").split("/").pop() || String(index + 1), 10) || index + 1

            results.push({
                id,
                title,
                link,
                timestamp,
                status: "",
                torrent_url: torrentUrl,
                info_hash: infoHash,
                magnet_uri: magnetUri,
                seeders,
                leechers,
                torrent_download_count: 0,
                tracker_updated: null,
                nzb_url: "",
                total_size: totalSize,
                num_files: 1,
                anidb_aid: 0,
                anidb_eid: 0,
                anidb_fid: 0,
                article_url: link,
                article_title: title,
                website_url: sourceUrl,
            })

            index += 1
        }

        return results
    }

    private searchByAID(aid: number, quality: string): Promise<AnimeToshoTorrent[]> {
        const q = this.formatQuality(quality)
        return this.fetchTorrents(this.buildApiUrl({ order: "size-d", aid: String(aid), q }))
    }

    private searchByEID(eid: number, quality: string): Promise<AnimeToshoTorrent[]> {
        const q = this.formatQuality(quality)
        return this.fetchTorrents(this.buildApiUrl({ eid: String(eid), q }))
    }

    private buildSmartSearchQueries(opts: AnimeSmartSearchOptions): string[] {
        const { media, batch, episodeNumber, resolution } = opts
        const hasSingleEpisode = media.episodeCount === 1 || media.format === "MOVIE"

        let queryStr: string[] = []
        const allTitles = this.getAllTitles(media)

        if (hasSingleEpisode) {
            let str = ""
            // 1. Build a query string
            const qTitles = `(${allTitles.map(t => this.sanitizeTitle(t)).join(" | ")})`
            str += qTitles

            // 2. Add resolution
            if (resolution) {
                str += " " + resolution
            }
            queryStr = [str]

        } else {
            if (!batch) { // Single episode search
                const qTitles = this.buildTitleString(opts)
                const qEpisodes = this.buildEpisodeString(opts)

                let str = ""
                // 1. Add titles
                str += qTitles
                // 2. Add episodes
                if (qEpisodes) {
                    str += " " + qEpisodes
                }
                // 3. Add resolution
                if (resolution) {
                    str += " " + resolution
                }

                queryStr.push(str)

                // If we can also search for absolute episodes
                if (media.absoluteSeasonOffset && media.absoluteSeasonOffset > 0) {
                    const metadata = $habari.parse(media.romajiTitle || "")
                    let absoluteQueryStr = metadata.title || ""

                    const ep = episodeNumber + media.absoluteSeasonOffset
                    absoluteQueryStr += ` ("${ep}"|"e${ep}"|"ep${ep}")`

                    if (resolution) {
                        absoluteQueryStr += " " + resolution
                    }
                    // Combine original query with absolute query
                    queryStr = [`(${absoluteQueryStr}) | (${str})`]
                }

            } else { // Batch search
                let str = `(${media.romajiTitle})`
                if (media.englishTitle) {
                    str = `(${media.romajiTitle} | ${media.englishTitle})`
                }
                str += " " + this.buildBatchGroup(media)
                if (resolution) {
                    str += " " + resolution
                }
                queryStr = [str]
            }
        }

        // Add "-S0" variant for each query (as in Go code)
        const finalQueries: string[] = []
        for (const q of queryStr) {
            finalQueries.push(q)
            finalQueries.push(q + " -S0")
        }

        return finalQueries
    }

    private formatQuality(quality: string): string {
        if (!quality) return ""
        return quality.replace(/p$/i, "")
    }

    private sanitizeTitle(t: string): string {
        t = t.replace(/-/g, " ") // Replace hyphens with spaces
        t = t.replace(/[^a-zA-Z0-9\s]/g, "") // Remove non-alphanumeric/space chars
        t = t.replace(/\s+/g, " ") // Trim large spaces
        return t.trim()
    }

    private getAllTitles(media: AnimeSmartSearchOptions["media"]): string[] {
        return [
            media.romajiTitle,
            media.englishTitle,
            ...(media.synonyms || []),
        ].filter(Boolean) as string[] // Filter out null/undefined/empty strings
    }

    private zeropad(v: number | string): string {
        return String(v).padStart(2, "0")
    }

    private buildEpisodeString(opts: AnimeSmartSearchOptions): string {
        if (opts.episodeNumber === -1) return ""
        const pEp = this.zeropad(opts.episodeNumber)
        // e.g. ("01"|"e1") -S0
        return `("${pEp}"|"e${opts.episodeNumber}") -S0`
    }

    private buildBatchGroup(media: AnimeSmartSearchOptions["media"]): string {
        const epCount = media.episodeCount || 0
        const parts = [
            `"${this.zeropad(1)} - ${this.zeropad(epCount)}"`,
            `"${this.zeropad(1)} ~ ${this.zeropad(epCount)}"`,
            `"Batch"`,
            `"Complete"`,
            `"+ OVA"`,
            `"+ Specials"`,
            `"+ Special"`,
            `"Seasons"`,
            `"Parts"`,
        ]
        return `(${parts.join("|")})`
    }

    private extractSeasonNumber(title: string): [number, string] {
        const match = title.match(/\b(season|s)\s*(\d{1,2})\b/i)
        if (match && match[2]) {
            const cleanTitle = title.replace(match[0], "").trim()
            return [parseInt(match[2]), cleanTitle]
        }
        return [0, title]
    }

    private buildTitleString(opts: AnimeSmartSearchOptions): string {
        const media = opts.media
        const romTitle = this.sanitizeTitle(media.romajiTitle || "")
        const engTitle = this.sanitizeTitle(media.englishTitle || "")

        let season = 0
        let titles: string[] = []

        // create titles by extracting season/part info
        this.getAllTitles(media).forEach(title => {
            const [s, cTitle] = this.extractSeasonNumber(title)
            if (s !== 0) season = s
            if (cTitle) titles.push(this.sanitizeTitle(cTitle))
        })

        // Check season from synonyms, only update season if it's still 0
        if (season === 0) {
            (media.synonyms || []).forEach(synonym => {
                const [s, _] = this.extractSeasonNumber(synonym)
                if (s !== 0) season = s
            })
        }

        // add romaji and english titles to the title list
        titles.push(romTitle)
        if (engTitle) titles.push(engTitle)

        // convert III and II to season
        if (season === 0) {
            if (/\siii\b/i.test(romTitle) || (engTitle && /\siii\b/i.test(engTitle))) season = 3
            else if (/\sii\b/i.test(romTitle) || (engTitle && /\sii\b/i.test(engTitle))) season = 2
        }

        // also, split titles by colon
        [romTitle, engTitle].filter(Boolean).forEach(title => {
            const split = title.split(":")
            if (split.length > 1 && split[0].length > 8) {
                titles.push(split[0])
            }
        })

        // clean titles
        titles = titles.map(title => {
            let clean = title.replace(/:/g, " ").replace(/-/g, " ").trim()
            clean = clean.replace(/\s+/g, " ").toLowerCase()
            if (season !== 0) {
                clean = clean.replace(/\siii\b/gi, "").replace(/\sii\b/gi, "")
            }
            return clean.trim()
        })

        titles = [...new Set(titles.filter(Boolean))] // Unique, non-empty titles

        let shortestTitle = titles.reduce((shortest, current) =>
            current.length < shortest.length ? current : shortest, titles[0] || "")

        // Season part
        let seasonBuff = ""
        if (season > 0) {
            const pS = this.zeropad(season)
            seasonBuff = [
                `"${shortestTitle} season ${season}"`,
                `"${shortestTitle} season ${pS}"`,
                `"${shortestTitle} s${season}"`,
                `"${shortestTitle} s${pS}"`,
            ].join(" | ")
        }

        let qTitles = `(${titles.map(t => `"${t}"`).join(" | ")}`
        if (seasonBuff) {
            qTitles += ` | ${seasonBuff}`
        }
        qTitles += ")"

        return qTitles
    }

    private torrentSliceToAnimeTorrentSlice(torrents: AnimeToshoTorrent[],
        confirmed: boolean,
        media: AnimeSmartSearchOptions["media"] | null,
    ): AnimeTorrent[] {
        return torrents.map(torrent => {
            const t = this.toAnimeTorrent(torrent, media)
            t.confirmed = confirmed
            return t
        })
    }

    private toAnimeTorrent(t: AnimeToshoTorrent, media: AnimeSmartSearchOptions["media"] | null): AnimeTorrent {
        const metadata = $habari.parse(t.title)

        // Convert UNIX timestamp to ISO string
        const formattedDate = new Date(t.timestamp * 1000).toISOString()

        const isBatch = t.num_files > 1
        let episode = -1

        if (metadata.episode_number && metadata.episode_number.length === 1) {
            episode = parseInt(metadata.episode_number[0]) || -1
        }

        // Force set episode number to 1 if it's a movie or single-episode and the torrent isn't a batch
        if (!isBatch && episode === -1 && media && (media.episodeCount === 1 || media.format === "MOVIE")) {
            episode = 1
        }

        // If it's a batch, don't assign an episode number
        if (isBatch) {
            episode = -1
        }

        return {
            name: t.title,
            date: formattedDate,
            size: t.total_size,
            formattedSize: this.bytesToHuman(t.total_size),
            seeders: t.seeders,
            leechers: t.leechers,
            downloadCount: t.torrent_download_count,
            link: t.link,
            downloadUrl: t.torrent_url,
            magnetLink: t.magnet_uri,
            infoHash: t.info_hash,
            resolution: metadata.video_resolution || "",
            isBatch: isBatch,
            episodeNumber: episode,
            releaseGroup: metadata.release_group || "",
            isBestRelease: false,
            confirmed: false,     // Will be set in torrentSliceToAnimeTorrentSlice
        }
    }

    private bytesToHuman(bytes: number): string {
        if (bytes === 0) return "0 Bytes"
        const k = 1024
        const sizes = ["Bytes", "KiB", "MiB", "GiB", "TiB"]
        const i = Math.floor(Math.log(bytes) / Math.log(k))
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i]
    }
}
