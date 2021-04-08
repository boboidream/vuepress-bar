const sortBy = require("lodash.sortby");
const glob = require("glob");
const markdownIt = require("markdown-it");
const meta = require("markdown-it-meta");
const { lstatSync, readdirSync, readFileSync, existsSync } = require("fs");
const { join, normalize, sep } = require("path");
const startCase = require("lodash.startcase");
const escapeRegExp = require("lodash.escaperegexp");
const slugify = require("transliteration").slugify;

const isDirectory = (source) => lstatSync(source).isDirectory();
const getDirectories = (source) => readdirSync(source).filter((name) => !(name === ".vuepress") && isDirectory(join(source, name)));

function getName(dir, { navPrefix, stripNumbers } = {}) {
	let name = dir.split(sep).pop();
	const argsIndex = name.lastIndexOf("--");
	if (argsIndex > -1) {
		name = name.substring(0, argsIndex);
	}

	if (navPrefix) {
		// "nav.001.xyz" or "nav-001.xyz" or "nav_001.xyz" or "nav 001.xyz" -> "nav"
		const pattern = new RegExp(`^${escapeRegExp(navPrefix)}[.-_ ]?`);
		name = name.replace(pattern, "");
	}
	if (stripNumbers) {
		// "001.guide" or "001-guide" or "001_guide" or "001 guide" -> "guide"
		name = name.replace(/^\d+[.\-_ ]?/, "");
	}

	return startCase(name);
}

// Load all MD files in a specified directory and order by metadata 'order' value
const getChildren = function(parent_path, dir, currentLevel, recursive = true) {
	// CREDITS: https://github.com/benjivm (from: https://github.com/vuejs/vuepress/issues/613#issuecomment-495751473)
	parent_path = normalize(parent_path);
	parent_path = parent_path.endsWith(sep) ? parent_path.slice(0, -1) : parent_path; // Remove last / if exists.
	const pattern = recursive ? "/**/*.md" : "/*.md";
	files = glob.sync(parent_path + (dir ? `/${dir}` : "") + pattern).map((path) => {
		// Instantiate MarkdownIt
		md = new markdownIt();
		// Add markdown-it-meta
		md.use(meta);
		// Get the order value
		file = readFileSync(path, "utf8");
		md.render(file);
		order = md.meta.order;
		//Remove ".md"
		path = path.slice(0, -3);
		// Remove "README", making it the de facto index page
		if (path.endsWith("README") || path.endsWith("readme")) {
			path_chip = path.slice(0, -7).split("/");
			path = path_chip[path_chip.length - 1] + "/";
			// path = path.slice(0, -6);
		}
		// Remove "parent_path" and ".md"
		else if (currentLevel !== 1) {
			path_chip = parent_path.split("\\");
			path = path_chip[path_chip.length - 1] + "/" + path.slice(parent_path.length + 1);
		}

		return {
			title: !md.meta.title ? "" : md.meta.title,
			path: !md.meta.title ? "/" : path,
			order: path === "" && order === undefined ? 0 : order // README is first if it hasn't order
		};
	});

	// Return the ordered list of files, sort by 'order' then 'path'
	return sortBy(files, ["order", "path"]).map((file) => {
		return { title: file.title, path: file.path };
	});
};

/**
 * Return sidebar config for given baseDir.
 * @param   {String} baseDir        - Absolute path of directory to get sidebar config for.
 * @param   {Object} options        - Options
 * @param   {String} relativeDir    - Relative directory to add to baseDir
 * @param   {Number} currentLevel   - Current level of items.
 * @returns {Array.<String|Object>} - Recursion level
 */
function side(baseDir, { stripNumbers, maxLevel, navPrefix, skipEmptySidebar, setHomepage } = {}, relativeDir = "", currentLevel = 1) {
	const fileLinks = getChildren(baseDir, relativeDir, currentLevel, currentLevel > maxLevel);

	if (currentLevel <= maxLevel) {
		getDirectories(join(baseDir, relativeDir))
			.filter((subDir) => !subDir.startsWith(navPrefix))
			.forEach((subDir) => {
				const children = side(baseDir, { stripNumbers, maxLevel, navPrefix, skipEmptySidebar }, join(relativeDir, subDir), currentLevel + 1);
				if (children.length > 0 || !skipEmptySidebar) {
					fileLinks.push({
						title: subDir,
						...parseSidebarParameters(subDir),
						children
					});
				}
			});
	}

	/**
	 * setHomepage: 'hide' | 'toGroup' | 'top'
	 * 'hide': Remove first README.md from sidebar.
	 * 'toGroup': Remove README.md from first position and add it to first group.
	 * 'top': Homepage appear  at top of sidebar.
	 */
	if (setHomepage !== "top" && fileLinks[0] === "" && typeof fileLinks[1] === "object") {
		fileLinks.shift();
		if (setHomepage === "toGroup") fileLinks[0].children.unshift("");
	}

	// sort file and folder by name
	fileLinks.sort((a, b) => {
		let aName = typeof a === "string" ? a : a.title;
		let bName = typeof b === "string" ? b : b.title;
		aName = aName.split("/").pop();
		bName = bName.split("/").pop();

		let aNum = /^(\d+)[\.\-_ ]?/.test(aName) ? Number(aName.match(/^(\d+)[\.\-_ ]?/)[1]) : aName;
		let bNum = /^(\d+)[\.\-_ ]?/.test(bName) ? Number(bName.match(/^(\d+)[\.\-_ ]?/)[1]) : bName;

		return aNum > bNum;
	});

	// strip number of folder's name
	fileLinks.forEach((item) => {
		if (typeof item === "string") return;
		item.title = getName(item.title, { stripNumbers, navPrefix });
	});

	return fileLinks;
}

/**
 * Gets sidebar parameters from directory name. Arguments are given after double dash `--` and separated by comma.
 * - `nc` sets collapsable to `false`.
 * - `dX` sets sidebarDepth to `X`.
 *
 * @param   {String} dirname  - Name of the directory.
 * @returns {Object}          - sidebar parameters.
 * @example
 * parseSidebarParameters("docs/api--nc,d2"); { collapsable: false, sidebarDepth: 2 }
 */
function parseSidebarParameters(dirname) {
	const index = dirname.lastIndexOf("--");
	if (index === -1) {
		return {};
	}

	const args = dirname.substring(index + 2).split(",");
	const parameters = {};

	args.forEach((arg) => {
		if (arg === "nc") {
			parameters.collapsable = false;
		} else if (arg.match(/d\d+/)) {
			parameters.sidebarDepth = Number(arg.substring(1));
		}
	});

	return parameters;
}

/**
 * Returns navbar configuration for given path.
 * @param   {String}          rootDir           - Path of the directory to get navbar configuration for.
 * @param   {OBject}          options           - Options
 * @param   {String}          relativeDir       - (Used internally for recursion) Relative directory to `rootDir` to get navconfig for.
 * @param   {Number}          currentNavLevel   - (Used internally for recursion) Recursion level.
 * @returns {Array.<Object>}
 */
function nav(rootDir, { navPrefix, stripNumbers, skipEmptyNavbar }, relativeDir = "/", currentNavLevel = 1) {
	const baseDir = join(rootDir, relativeDir);
	const childrenDirs = getDirectories(baseDir).filter((subDir) => subDir.startsWith(navPrefix));
	const options = { navPrefix, stripNumbers, skipEmptyNavbar };
	let result;

	if (currentNavLevel > 1 && childrenDirs.length === 0) {
		if (!existsSync(join(baseDir, "README.md"))) {
			if (skipEmptyNavbar) {
				return;
			} else {
				throw new Error(`README.md file cannot be found in ${baseDir}. VuePress would return 404 for that NavBar link.`);
			}
		}
		result = { text: getName(baseDir, { stripNumbers, navPrefix }), link: relativeDir + sep };
	} else if (childrenDirs.length > 0) {
		const items = childrenDirs.map((subDir) => nav(rootDir, options, join(relativeDir, subDir), currentNavLevel + 1)).filter(Boolean);
		result = currentNavLevel === 1 ? items : { text: getName(baseDir, { stripNumbers, navPrefix }), items };
	}

	return result;
}

/**
 * Returns multiple sidebars for given directory.
 * @param {String}    rootDir       - Directory to get navbars for.
 * @param {Object}    nav           - Navigation configuration (Used for calculating sidebars' roots.)
 * @param {Object}    options       - Options
 * @param {Number}    currentLevel  - Recursion level.
 * @returns {Object}                - Multiple navbars.
 */
function multiSide(rootDir, nav, { stripNumbers, maxLevel, navPrefix, skipEmptySidebar, setHomepage }, currentLevel = 1) {
	const sideBar = {};
	const options = { stripNumbers, maxLevel, navPrefix, skipEmptySidebar, setHomepage };

	nav.forEach((navItem) => {
		if (navItem.link) {
			sideBar[navItem.link] = side(join(rootDir, navItem.link), options);
		} else {
			Object.assign(sideBar, multiSide(rootDir, navItem.items, options), currentLevel + 1);
		}
	});

	if (skipEmptySidebar) {
		Object.keys(sideBar).forEach((key) => {
			if (sideBar[key].length === 0) {
				delete sideBar[key];
			}
		});
	}

	if (currentLevel === 1) {
		const fallBackSide = side(rootDir, options);
		if (!skipEmptySidebar || fallBackSide.length > 0) {
			sideBar["/"] = side(rootDir, options);
		}
	}

	return sideBar;
}

/**
 * Returns `nav` and `sidebar` configuration for VuePress calculated using structrue of directory and files in given path.
 * @param   {String}    rootDir   - Directory to get configuration for.
 * @param   {Object}    options   - Options
 * @returns {Object}              - { nav: ..., sidebar: ... } configuration.
 */
function getConfig(
	rootDir,
	{ stripNumbers = true, maxLevel = 2, navPrefix = "nav", skipEmptySidebar = true, skipEmptyNavbar = true, multipleSideBar = true, setHomepage = "hide", pinyinNav = false } = {}
) {
	rootDir = normalize(rootDir);
	rootDir = rootDir.endsWith(sep) ? rootDir.slice(0, -1) : rootDir; // Remove last / if exists.
	const options = {
		stripNumbers,
		maxLevel,
		navPrefix,
		skipEmptySidebar,
		skipEmptyNavbar,
		multipleSideBar,
		setHomepage,
		pinyinNav
	};
	const navItems = nav(rootDir, options);

	return {
		nav: navItems || [],
		sidebar: multipleSideBar && navItems ? multiSide(rootDir, navItems, options) : side(rootDir, options)
	};
}

/**
 * Translate chinese to pinyin.
 * Compatible with vuepress-pluin-permalink-pinyin.
 * @param {Array} navArr
 */
function translitePinyin(navArr) {
	navArr.map((nav) => {
		if (nav.link) {
			nav.link = slugify(nav.link, { ignore: ["/", "."] });
		}
		if (nav.items) {
			translitePinyin(nav.items);
		}
	});
}

/**
 * Translate chinese nav link to pinyin.
 * Compatible with vuepress-pluin-permalink-pinyin.
 * @param {Array} navArr
 */
function transliteNavPinyin(navArr, { navPrefix, stripNumbers } = {}) {
	navArr.map((nav) => {
		if (nav.link) {
			if (navPrefix) {
				// "nav.001.xyz" or "nav-001.xyz" or "nav_001.xyz" or "nav 001.xyz" -> "nav"
				const pattern = new RegExp(`${escapeRegExp(navPrefix)}[.-_ ]?`);
				nav.link = nav.link.replace(pattern, "");
			}
			if (stripNumbers) {
				// "001.guide" or "001-guide" or "001_guide" or "001 guide" -> "guide"
				nav.link = nav.link.replace(/\d+[.\-_ ]?/, "");
			}
			nav.link = "/" + slugify(nav.link, { ignore: ["/", "."] }) + "/";
		}
		if (nav.items) {
			transliteNavPinyin(nav.items, { navPrefix, stripNumbers });
		}
	});
}

/**
 * Translate chinese sidebar link to pinyin.
 * Compatible with vuepress-pluin-permalink-pinyin.
 * @param {Array} navArr
 */
function transliteSidePinyin(sidebar, { multipleSideBar, navPrefix, stripNumbers } = {}) {
	if (Array.isArray(sidebar)) {
		sidebar.map((v, i, arr) => {
			if (v.path && v.path !== "/") {
				if (navPrefix) {
					// "nav.001.xyz" or "nav-001.xyz" or "nav_001.xyz" or "nav 001.xyz" -> "nav"
					const pattern = new RegExp(`${escapeRegExp(navPrefix)}[.-_ ]?`);
					v.path = v.path.replace(pattern, "");
				}
				if (stripNumbers) {
					// "001.guide" or "001-guide" or "001_guide" or "001 guide" -> "guide"
					v.path = v.path.replace(/\d+[.\-_ ]?/, "");
				}
				v.path = "/" + slugify(v.path, { ignore: ["/", "."] }) + ".html";
			}
		});
	} else {
		for (var key in sidebar) {
			let hKey = key,
				newKey = key;
			if (key !== "/") {
				if (navPrefix) {
					// "nav.001.xyz" or "nav-001.xyz" or "nav_001.xyz" or "nav 001.xyz" -> "nav"
					const pattern = new RegExp(`${escapeRegExp(navPrefix)}[.-_ ]?`);
					hKey = hKey.replace(pattern, "");
				}
				if (stripNumbers) {
					// "001.guide" or "001-guide" or "001_guide" or "001 guide" -> "guide"
					hKey = hKey.replace(/\d+[.\-_ ]?/, "");
				}
				newKey = "/" + slugify(hKey, { ignore: ["/", "."] }) + "/";
				sidebar[newKey] = sidebar[key];
				sidebar[newKey].title = hKey.replace(/\\/g, "");
				if (sidebar[key].path) sidebar[newKey].path = newKey;
				delete sidebar[key];
			}
			sidebar[newKey].map((v, i, arr) => {
				if (v.children) transliteSidePinyin(v.children, { navPrefix, stripNumbers });
				else transliteSidePinyin(arr, { navPrefix, stripNumbers });
			});
		}
		if (multipleSideBar) {
			let home = sidebar["/"];
			delete sidebar["/"];
			sidebar["/"] = home;
		}
	}
}

module.exports = (options, ctx) => {
	// ctx.pages.map((page) => {
	// 	page.regularPath = encodeURI(page.regularPath);
	// });
	return {
		async ready() {
			const { themeConfig } = ctx.getSiteData ? ctx.getSiteData() : ctx;
			const { rootDir = ctx.sourceDir } = options;
			const { nav, sidebar } = await getConfig(rootDir, options);

			if (options.pinyinNav && nav.length) {
				transliteNavPinyin(nav, options);
			}

			if (themeConfig.nav && themeConfig.nav.length) {
				themeConfig.nav = [...themeConfig.nav, ...nav];
			} else {
				themeConfig.nav = nav;
			}

			if (options.pinyinNav && sidebar) {
				transliteSidePinyin(sidebar, options);
			}

			themeConfig.sidebar = sidebar;
			ctx.pages.forEach((page) => {
				page.regularPath = page.path;
			});
			return { nav, sidebar };
		}
	};
};
