
const components = {
  install: (app) => {
    const modules = import.meta.glob('../components/plugins/*', { eager: true });
    console.info(modules);
    Object.entries(modules).forEach(([path, m]) => {
      const name = path.split('/').pop().replace(/\.\w+$/, '')
      console.info(name)
      app.component('Plugin'+name, m['default']);
    })
  }
}
export default components;
